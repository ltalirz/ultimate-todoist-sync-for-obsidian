import { App, Notice, requestUrl } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../../main";
import { DeviceManager } from '../utils/deviceManager';


type Event = {
  id: string;
  object_type: string;
  object_id: string;
  event_type: string;
  event_date: string;
  parent_project_id: string;
  parent_item_id: string | null;
  initiator_id: string | null;
  extra_data: Record<string, any>;
};

type FilterOptions = {
  event_type?: string;
  object_type?: string;
};

export class TodoistSyncAPI   {
	app:App;
  	plugin: UltimateTodoistSyncForObsidian;
  	deviceManager: DeviceManager;

	private readonly PARTIAL_SYNC_LIMIT = 1000;
	private readonly FULL_SYNC_LIMIT = 100;
	private readonly WINDOW_DURATION = 15 * 60 * 1000;

	private rateLimitState = {
		partialSyncCount: 0,
		fullSyncCount: 0,
		windowStartTime: Date.now()
	};

	// Store complete raw API response
	// Store complete raw API response
	private syncData: Record<string, any> | null = null;
	// API-level sync lock — prevents concurrent incrementalSync/initializeSync
	private _syncRunning = false;
	private _syncDirty = false;
	private _syncWaiters: Array<{ resolve: () => void; reject: (err: any) => void }> = [];

	constructor(app:App, plugin:UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
    	this.plugin = plugin;
		this.deviceManager = new DeviceManager(app, plugin);
	}

	private resetRateLimits(): void {
		this.rateLimitState.partialSyncCount = 0;
		this.rateLimitState.fullSyncCount = 0;
		this.rateLimitState.windowStartTime = Date.now();
	}

	private checkRateLimitWindow(): void {
		if (Date.now() - this.rateLimitState.windowStartTime > this.WINDOW_DURATION) {
			this.resetRateLimits();
		}
	}

	private async checkRateLimit(isFullSync: boolean): Promise<void> {
		this.checkRateLimitWindow();

		const limit = isFullSync ? this.FULL_SYNC_LIMIT : this.PARTIAL_SYNC_LIMIT;
		const used = isFullSync ? this.rateLimitState.fullSyncCount : this.rateLimitState.partialSyncCount;

		if (used >= limit) {
			const waitMinutes = Math.ceil((this.WINDOW_DURATION - (Date.now() - this.rateLimitState.windowStartTime)) / 60000);
			throw new Error(`RATE_LIMIT_EXCEEDED:${waitMinutes}`);
		}
	}

	private handleRateLimitError(error: Error): void {
		const message = error.message;

		if (message.includes('RATE_LIMIT_EXCEEDED')) {
			const waitMinutes = message.split(':')[1] || '15';
			new Notice(
				`⚠️ Todoist API Rate Limit Reached!\n\n` +
				`You have reached the ${this.rateLimitState.fullSyncCount >= this.FULL_SYNC_LIMIT ? 'full' : 'partial'} sync limit.\n` +
				`Please wait ${waitMinutes} minutes before next sync.\n\n` +
				`Tip: Reduce sync frequency to avoid hitting limits.`,
				15000
			);
		} else if (message.includes('429')) {
			new Notice(
				`⚠️ Too Many Requests to Todoist!\n\n` +
				`Please wait 15 minutes before next sync.\n\n` +
				`Tip: Reduce sync frequency to avoid hitting rate limits.`,
				15000
			);
		}
	}

	private async getClientHeader(): Promise<string> {
		return await this.deviceManager.getClientHeader();
	}

	async initializeSync(): Promise<void> {
		// Route through incrementalSync lock so concurrent callers wait
		if (this._syncRunning) {
			return new Promise<void>((resolve, reject) => {
				this._syncDirty = true;
				this._syncWaiters.push({ resolve, reject });
			});
		}
		this._syncRunning = true;
		this._syncDirty = false;
		const waiters = this._syncWaiters.splice(0);
		try {
			const data = await this.getAllResources(true);
			this.syncData = data;
			await this.plugin.safeSettings?.update({ syncDataCache: data }, true);
			this.plugin.debugLog('[TodoistSyncAPI] Sync initialized with full data and cached');
			waiters.forEach(w => w.resolve());
		} catch (error) {
			waiters.forEach(w => w.reject(error));
			throw error;
		} finally {
			this._syncRunning = false;
		}
	}
	async incrementalSync(): Promise<void> {
		if (!this.syncData) {
			await this.initializeSync();
			return;
		}

		// If a sync is already running, mark dirty and wait for it to finish
		if (this._syncRunning) {
			return new Promise<void>((resolve, reject) => {
				this._syncDirty = true;
				this._syncWaiters.push({ resolve, reject });
			});
		}

		this._syncRunning = true;
		this._syncDirty = false;
		const waiters = this._syncWaiters.splice(0);
		try {
			do {
				this._syncDirty = false;
				const changes = await this.getAllResources(false);
				// Detect sync_token expiration: if Todoist returns full_sync=true,
				// the token was expired/invalid. Fall back to full sync.
				if (changes.full_sync === true) {
					console.warn('[TodoistSyncAPI] sync_token expired, falling back to full sync');
					this.syncData = changes;
					await this.plugin.safeSettings?.update({ syncDataCache: this.syncData }, true);
					this.plugin.debugLog('[TodoistSyncAPI] Full sync fallback completed');
					break;
				}
				this.mergeSyncData(changes);
				await this.plugin.safeSettings?.update({ syncDataCache: this.syncData }, true);
				this.plugin.debugLog('[TodoistSyncAPI] Incremental sync completed and cached');
			} while (this._syncDirty);
			waiters.forEach(w => w.resolve());
		} catch (error) {
			console.error('[TodoistSyncAPI] Incremental sync failed:', error);
			waiters.forEach(w => w.reject(error));
		} finally {
			this._syncRunning = false;
		}
	}

	private mergeSyncData(changes: any): void {
		if (!this.syncData) return;

		// Merge all top-level fields from the API response
		for (const key of Object.keys(changes)) {
			if (key === 'sync_token') {
				// Update sync_token separately
				this.syncData.sync_token = changes.sync_token;
				continue;
			}

			const changesData = changes[key];

			// Handle array data with ID-based merging (projects, items, sections, labels, notes)
			if (Array.isArray(changesData)) {
				const existingData = this.syncData[key];
				if (Array.isArray(existingData)) {
					const dataMap = new Map(existingData.map((item: any) => [item.id, item]));
					for (const item of changesData) {
						if (item.is_deleted) {
							dataMap.delete(item.id);
						} else {
							dataMap.set(item.id, item);
						}
					}
					this.syncData[key] = Array.from(dataMap.values());
				} else {
					// No existing data, just use the changes
					this.syncData[key] = changesData;
				}
			} else {
				// Non-array data (objects like settings, user, etc.) - just replace
				this.syncData[key] = changesData;
			}
		}
	}

	getSyncData(): Record<string, any> | null {
		return this.syncData;
	}

	// Load sync data from cache (called on plugin startup)
	loadFromCache(): boolean {
		if (this.plugin.settings.syncDataCache) {
			this.syncData = this.plugin.settings.syncDataCache;
			this.plugin.debugLog('[TodoistSyncAPI] Loaded sync data from cache');
			return true;
		}
		return false;
	}

    async getAllResources(fullSync = false) { 
		const clientId = await this.getClientHeader();
    	const accessToken = this.plugin.settings.todoistAPIToken;
		const syncToken = fullSync ? '*' : (this.syncData?.sync_token || '*');
		
		await this.checkRateLimit(fullSync);

    	const url = 'https://api.todoist.com/api/v1/sync';
    	const options = {
    		url: url,
    		method: 'POST',
    		headers: {
    			'Authorization': `Bearer ${accessToken}`,
 				'Content-Type': 'application/x-www-form-urlencoded',
 				'X-Todoist-Client': clientId
    		},
    		body: new URLSearchParams({
    			sync_token: syncToken,
    			resource_types: '["all"]'
    		}).toString()
    	};
  
    	try {
    		const response = await requestUrl(options);

			if (response.status === 429) {
				throw new Error('RATE_LIMIT_429');
			}
  
			if (response.status >= 400) {
 				throw new Error(`Failed to fetch all resources: ${response.status} ${response.text}`);
 			}
  
 			const data = response.json;

		if (fullSync) {
			this.rateLimitState.fullSyncCount++;
		} else {
			this.rateLimitState.partialSyncCount++;
		}
  
      		return data;
    	} catch (error: any) {
			if (error.message && (error.message.includes('RATE_LIMIT') || error.message.includes('429'))) {
				this.handleRateLimitError(error);
			}
      		console.error(error);
      		throw new Error('Failed to fetch all resources due to network error');
    	}
    }

    //backup todoist
    async getUserResource() { 
      const accessToken = this.plugin.settings.todoistAPIToken
      const url = 'https://api.todoist.com/api/v1/sync';
      const options = {
        url: url,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          sync_token: "*",
          resource_types: '["user_plan_limits"]'
        }).toString()
      };
    
      try {
        const response = await requestUrl(options);
    
        if (response.status >= 400) {
          throw new Error(`Failed to fetch all resources: ${response.status} ${response.text}`);
        }
    
        const data = response.json;
        this.plugin.debugLog(data)
        return data;
      } catch (error) {
        console.error(error)
        throw new Error('Failed to fetch user resources due to network error');
      }
      }


      //update user timezone
      async updateUserTimezone() { 
        const unixTimestampString: string = Math.floor(Date.now() / 1000).toString();
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/api/v1/sync';
        const commands = [
          {
            'type': "user_update",
            'uuid': unixTimestampString,
            'args': { 'timezone': Intl.DateTimeFormat().resolvedOptions().timeZone },
          },
        ];
        const options = {
          url: url,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({ commands: JSON.stringify(commands) }).toString()
        };
      
        try {
          const response = await requestUrl(options);
      
          if (response.status >= 400) {
            throw new Error(`Failed to fetch all resources: ${response.status} ${response.text}`);
          }
      
          const data = response.json;
          this.plugin.debugLog(data)
          return data;
        } catch (error) {
          console.error('[updateUserTimezone] Failed:', error);
          throw new Error('Failed to fetch user resources due to network error');
        }
        }
   
    //get activity logs
    //result  {results:[],next_cursor:null}
    async getAllActivityEvents() {
 	const clientId = await this.getClientHeader();
    const accessToken = this.plugin.settings.todoistAPIToken
    
      try {
        const response = await requestUrl({
          url: 'https://api.todoist.com/api/v1/activities',
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
    		'X-Todoist-Client': clientId
          }
        });
    
        if (response.status >= 400) {
          throw new Error(`API returned error status: ${response.status}`);
        }
    
        const data = response.json;
    
        // API v1 返回格式: { results: [], next_cursor: null }
        // 转换为旧格式: { events: [] }
        return { events: data.results || [] };
      } catch (error) {
        throw error;
      }
    }


  
  

    

    filterActivityEvents(events: Event[], options: FilterOptions): Event[] {
      return events.filter(event => 
        (options.event_type ? event.event_type === options.event_type : true) &&
        (options.object_type ? event.object_type === options.object_type : true)
    
        );
    }

    //get completed items activity
    //result  {results:[],next_cursor:null}
    async getCompletedItemsActivity() {
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/api/v1/activities?event_type=completed';
        
        try {
            const response = await requestUrl({
                url: url,
                method: 'GET',
                headers: {
                'Authorization': `Bearer ${accessToken}`
                }
            });
        
            if (response.status >= 400) {
            throw new Error(`Failed to fetch completed items: ${response.status} ${response.text}`);
            }
        
            const data = response.json;
        
            // API v1 返回格式: { results: [], next_cursor: null }
            // 转换为旧格式: { events: [] }
            return { events: data.results || [] };
        } catch (error) {
            console.error(error);
            throw new Error('Failed to fetch completed items due to network error');
        }
    }
  
  
  
    //get uncompleted items activity
    //result  {results:[],next_cursor:null}
    async getUncompletedItemsActivity() {
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/api/v1/activities?event_type=uncompleted';
    
        try {
            const response = await requestUrl({
                url: url,
                method: 'GET',
                headers: {
                'Authorization': `Bearer ${accessToken}`
                }
            });
    
            if (response.status >= 400) {
                throw new Error(`Failed to fetch uncompleted items: ${response.status} ${response.text}`);
            }
    
            const data = response.json;
    
            // API v1 返回格式: { results: [], next_cursor: null }
            // 转换为旧格式: { events: [] }
            return { events: data.results || [] };
        } catch (error) {
            console.error(error);
            throw new Error('Failed to fetch uncompleted items due to network error');
        }
    }
  
   

  
  

  
  
    //get updated items activity
    //result  {results:[],next_cursor:null}
    async getUpdatedItemsActivity() {
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/api/v1/activities?event_type=updated';
    
        try {
            const response = await requestUrl({
                url: url,
                method: 'GET',
                headers: {
                'Authorization': `Bearer ${accessToken}`
                }
            });
    
            if (response.status >= 400) {
                throw new Error(`Failed to fetch updated items: ${response.status} ${response.text}`);
            }
    
            const data = response.json;
    
            // API v1 返回格式: { results: [], next_cursor: null }
            // 转换为旧格式: { events: [] }
            return { events: data.results || [] };
        } catch (error) {
            console.error(error);
            throw new Error('Failed to fetch updated items due to network error');
        }
    }
   
   


//get projects activity
    //result  {results:[],next_cursor:null}
    async getProjectsActivity() {
      const accessToken = this.plugin.settings.todoistAPIToken
      const url = 'https://api.todoist.com/api/v1/activities?object_type=project';
      
      try {
          const response = await requestUrl({
              url: url,
              method: 'GET',
              headers: {
              'Authorization': `Bearer ${accessToken}`
              }
          });
      
          if (response.status >= 400) {
            throw new Error(`Failed to fetch projects activities: ${response.status} ${response.text}`);
          }
      
          const data = response.json;
      
          // API v1 返回格式: { results: [], next_cursor: null }
          // 转换为旧格式: { events: [] }
          return { events: data.results || [] };
      } catch (error) {
          console.error(error);
          throw new Error('Failed to fetch projects activities due to network error');
      }
  }

  // Generate unique UUID for commands
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private generateTempId(): string {
    return this.generateUUID();
  }

  // Execute Sync API commands
  async executeCommands(commands: any[]): Promise<any> {
 	await this.checkRateLimit(false);

 	const clientId = await this.getClientHeader();
    const accessToken = this.plugin.settings.todoistAPIToken;
    const url = 'https://api.todoist.com/api/v1/sync';
    
    const options = {
      url: url,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
 		'Content-Type': 'application/x-www-form-urlencoded',
 		'X-Todoist-Client': clientId
      },
      body: new URLSearchParams({
        commands: JSON.stringify(commands)
      }).toString()
    };

    try {
      const response = await requestUrl(options);

 		if (response.status === 429) {
 			throw new Error('RATE_LIMIT_429');
 		}

      if (response.status >= 400) {
        throw new Error(`Failed to execute commands: ${response.status} - ${response.text}`);
      }
      const data = response.json;

		if (data?.sync_status) {
			for (const [uuid, status] of Object.entries(data.sync_status)) {
				if (status !== 'ok' && typeof status === 'object' && status !== null) {
					const err = status as { error?: string; error_code?: number; error_tag?: string };
					console.error(`[TodoistSyncAPI] Command ${uuid} failed:`, err);
				}
			}
		}

		this.rateLimitState.partialSyncCount++;


      return data;
    } catch (error: any) {
		if (error.message && (error.message.includes('RATE_LIMIT') || error.message.includes('429'))) {
			this.handleRateLimitError(error);
		}
      	console.error('Error executing commands:', error);
      	throw error;
    }
  }

  // Add task using Sync API
  async addTask(args: {
    content: string;
    project_id: string;
    parent_id?: string;
    due?: { string?: string; date?: string; datetime?: string };
    priority?: number;
    description?: string;
  }): Promise<{ id: string }> {
    const tempId = this.generateTempId();
    const command = {
      type: 'item_add',
      uuid: this.generateUUID(),
      temp_id: tempId,
      args: args
    };

    const result = await this.executeCommands([command]);
    if (result && result.temp_id_mapping && result.temp_id_mapping[tempId]) {
      return { id: result.temp_id_mapping[tempId] };
    }
    const cmdStatus = result?.sync_status?.[command.uuid];
    if (cmdStatus && cmdStatus !== 'ok') {
      const err = cmdStatus as { error?: string; error_code?: number };
      throw new Error(`Failed to add task: ${err.error || JSON.stringify(cmdStatus)}`);
    }
    throw new Error(`Failed to add task: no temp_id_mapping in response. Response: ${JSON.stringify(result)}`);
  }

  // Update task using Sync API
  async updateTask(taskId: string, args: {
    content?: string;
    description?: string;
    priority?: number;
    due?: { string?: string; date?: string };
  }): Promise<boolean> {
    const command = {
      type: 'item_update',
      uuid: this.generateUUID(),
      args: {
        id: taskId,
        ...args
      }
    };

    await this.executeCommands([command]);
    return true;
  }

  // Close task using Sync API
  async closeTask(taskId: string): Promise<boolean> {
    const command = {
      type: 'item_close',
      uuid: this.generateUUID(),
      args: {
        id: taskId
      }
    };

    await this.executeCommands([command]);
    return true;
  }

  // Reopen task using Sync API (item_uncomplete per official docs)
  async reopenTask(taskId: string): Promise<boolean> {
    const command = {
      type: 'item_uncomplete',
      uuid: this.generateUUID(),
      args: {
        id: taskId
      }
    };

    await this.executeCommands([command]);
    return true;
  }

  // Compatible wrapper: AddTask
  async AddTask(task: {
    projectId: string;
    content: string;
    parentId?: string;
    dueDate?: string;
    dueDatetime?: string;
    labels?: string[];
    description?: string;
    priority?: number;
  }): Promise<{ id: string }> {
    const args: any = {
      content: task.content,
    };

    if (task.projectId) {
      args.project_id = task.projectId;
    }

    if (task.parentId) {
      args.parent_id = task.parentId;
    }

    if (task.dueDate) {
      args.due = { date: task.dueDate };
    } else if (task.dueDatetime) {
      args.due = { datetime: task.dueDatetime };
    }

    if (task.priority) {
      args.priority = task.priority;
    }

    if (task.description) {
      args.description = task.description;
    }

    if (task.labels && task.labels.length > 0) {
      args.labels = task.labels;
    }

    return this.addTask(args);
  }

  // Compatible wrapper: UpdateTask
  async UpdateTask(taskId: string, updates: {
    content?: string;
    description?: string;
    labels?: string[];
    dueDate?: string;
    dueDatetime?: string;
    dueString?: string;
    parentId?: string;
    priority?: number;
  }): Promise<boolean> {
    const args: any = {};

    if (updates.content) args.content = updates.content;
    if (updates.description) args.description = updates.description;
    if (updates.labels) args.labels = updates.labels;
    if (updates.parentId) args.parent_id = updates.parentId;
    if (updates.priority) args.priority = updates.priority;

    if (updates.dueDate) {
      args.due = { date: updates.dueDate };
    } else if (updates.dueDatetime) {
      args.due = { datetime: updates.dueDatetime };
    } else if (updates.dueString) {
      args.due = { string: updates.dueString };
    }

    return this.updateTask(taskId, args);
  }

  // Compatible wrapper: CloseTask
  async CloseTask(taskId: string): Promise<boolean> {
    return this.closeTask(taskId);
  }

  // Compatible wrapper: OpenTask
  async OpenTask(taskId: string): Promise<boolean> {
    return this.reopenTask(taskId);
  }

  // Compatible wrapper: GetAllProjects
  async GetAllProjects(): Promise<any[]> {
    try {
      if (!this.syncData) {
        this.syncData = await this.getAllResources(true);
      }
      return this.syncData?.projects || [];
    } catch (error) {
      console.error('Error getting all projects:', error);
      throw error;
    }
  }

  // Compatible wrapper: GetTaskById
  async GetTaskById(taskId: string): Promise<any> {
    try {
      if (!this.syncData) {
        this.syncData = await this.getAllResources(true);
      }
      const tasks = this.syncData?.items || [];
      const found = tasks.find((t: any) => t.id === taskId);
      if (found) return found;

      // Not in local cache — do an incremental sync and retry once.
      // This handles the race where a task was just created and syncData
      // hasn't been updated yet (e.g. lineModifiedTaskCheck fires immediately
      // after lineContentNewTaskCheck).
      try {
        await this.incrementalSync();
      } catch (_) {
        // ignore sync errors here; fall through to return undefined
      }
      const refreshed = this.syncData?.items || [];
      return refreshed.find((t: any) => t.id === taskId);
    } catch (error) {
      console.error('Error getting task by id:', error);
      throw error;
    }
  }

  // Local-only lookup: no network requests, returns undefined if not found
  getTaskByIdLocal(taskId: string): any {
    return this.syncData?.items?.find((t: any) => t.id === taskId);
  }

  // Compatible wrapper: GetActiveTasks
  async GetActiveTasks(options?: {
    projectId?: string;
    section_id?: string;
    label?: string;
    filter?: string;
    lang?: string;
    ids?: string[];
  }): Promise<any[]> {
    try {
      if (!this.syncData) {
        this.syncData = await this.getAllResources(true);
      }
      let tasks = this.syncData?.items || [];

      if (options) {
        if (options.projectId) {
          tasks = tasks.filter((t: any) => t.project_id === options.projectId);
        }
        if (options.section_id) {
          tasks = tasks.filter((t: any) => t.section_id === options.section_id);
        }
        if (options.label) {
          tasks = tasks.filter((t: any) => t.labels && t.labels.includes(options.label));
        }
        if (options.ids && options.ids.length > 0) {
          tasks = tasks.filter((t: any) => options.ids!.includes(t.id));
        }
      }

      return tasks;
    } catch (error) {
      console.error('Error getting active tasks:', error);
      throw error;
    }
  }

  // Get project by ID from syncData
  async getProjectById(projectId: string): Promise<any> {
    try {
      if (!this.syncData) {
        this.syncData = await this.getAllResources(true);
      }
      const projects = this.syncData?.projects || [];
      return projects.find((p: any) => p.id === projectId);
    } catch (error) {
      console.error('Error getting project by id:', error);
      throw error;
    }
  }

  // Get project by name from syncData
  async getProjectByName(projectName: string): Promise<any> {
    try {
      if (!this.syncData) {
        this.syncData = await this.getAllResources(true);
      }
      const projects = this.syncData?.projects || [];
      return projects.find((p: any) => p.name === projectName);
    } catch (error) {
      console.error('Error getting project by name:', error);
      throw error;
    }
  }

  // Compatible wrapper: InitializeAPI (returns self for compatibility)
  initializeAPI(): TodoistSyncAPI {
    return this;
  }

  // Delete task using Sync API
  async deleteTask(taskId: string): Promise<boolean> {
    const command = {
      type: 'item_delete',
      uuid: this.generateUUID(),
      args: {
        id: taskId
      }
    };

    await this.executeCommands([command]);
    return true;
  }

  /**
   * Convert legacy (numeric) IDs to new opaque string IDs by matching task content
   * @param tasksNeedConversion - Array of tasks with legacy IDs and their content
   * @returns Mapping from legacy ID to new ID
   */
  async convertLegacyIds(
    tasksNeedConversion: { taskId: string; content: string; filePath: string; lineNumber: number }[]
  ): Promise<{ [oldId: string]: string }> {
    const mapping: { [oldId: string]: string } = {};
    
    if (!tasksNeedConversion || tasksNeedConversion.length === 0) {
      return mapping;
    }

    try {
      if (!this.syncData) {
        this.syncData = await this.getAllResources(true);
      }
      const allTasks = this.syncData?.items || [];
      
      for (const taskInfo of tasksNeedConversion) {
        const normalizedContent = this.normalizeContent(taskInfo.content);
        
        const matches = allTasks.filter((t: any) => 
          this.normalizeContent(t.content) === normalizedContent
        );
        
        if (matches.length === 0) {
          this.plugin.debugLog(`[convertLegacyIds] No match found for: ${taskInfo.content}`);
          continue;
        }
        
        if (matches.length > 1) {
          console.warn(`[convertLegacyIds] Multiple matches found for "${taskInfo.content}" in ${taskInfo.filePath}:${taskInfo.lineNumber}, skipping...`);
          continue;
        }
        
        mapping[taskInfo.taskId] = matches[0].id;
        this.plugin.debugLog(`[convertLegacyIds] Mapped ${taskInfo.taskId} -> ${matches[0].id} (${taskInfo.content})`);
      }
      
      this.plugin.debugLog(`[convertLegacyIds] Converted ${Object.keys(mapping).length} IDs`);
    } catch (error) {
      console.error('[convertLegacyIds] Error converting legacy IDs:', error);
      throw error;
    }
    
    return mapping;
  }

  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
        
}


