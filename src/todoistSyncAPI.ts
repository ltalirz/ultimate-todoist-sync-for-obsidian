import { App} from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";


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

	constructor(app:App, plugin:UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
    this.plugin = plugin;
	}

    //backup todoist
    async getAllResources() { 
    const accessToken = this.plugin.settings.todoistAPIToken
    const url = 'https://api.todoist.com/api/v1/sync';
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        sync_token: "*",
        resource_types: '["all"]'
      })
    };
  
    try {
      const response = await fetch(url, options);
  
      if (!response.ok) {
        throw new Error(`Failed to fetch all resources: ${response.status} ${response.statusText}`);
      }
  
      const data = await response.json();
  
      return data;
    } catch (error) {
      console.error(error);
      throw new Error('Failed to fetch all resources due to network error');
    }
    }

    //backup todoist
    async getUserResource() { 
      const accessToken = this.plugin.settings.todoistAPIToken
      const url = 'https://api.todoist.com/api/v1/sync';
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          sync_token: "*",
          resource_types: '["user_plan_limits"]'
        })
      };
    
      try {
        const response = await fetch(url, options);
    
        if (!response.ok) {
          throw new Error(`Failed to fetch all resources: ${response.status} ${response.statusText}`);
        }
    
        const data = await response.json();
        console.log(data)
        return data;
      } catch (error) {
        console.error(error);
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
            'args': { 'timezone': 'Asia/Shanghai' },
          },
        ];
        const options = {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({ commands: JSON.stringify(commands) })
        };
      
        try {
          const response = await fetch(url, options);
      
          if (!response.ok) {
            throw new Error(`Failed to fetch all resources: ${response.status} ${response.statusText}`);
          }
      
          const data = await response.json();
          console.log(data)
          return data;
        } catch (error) {
          console.error(error);
          throw new Error('Failed to fetch user resources due to network error');
        }
        }
  
    //get activity logs
    //result  {results:[],next_cursor:null}
    async getAllActivityEvents() {
    const accessToken = this.plugin.settings.todoistAPIToken
      const headers = new Headers({
        Authorization: `Bearer ${accessToken}`
      });
    
      try {
        const response = await fetch('https://api.todoist.com/api/v1/activities', {
          method: 'GET',
          headers
        });
    
        if (!response.ok) {
          throw new Error(`API returned error status: ${response.status}`);
        }
    
        const data = await response.json();
    
        // API v1 返回格式: { results: [], next_cursor: null }
        // 转换为旧格式: { events: [] }
        return { events: data.results || [] };
      } catch (error) {
        throw error;
      }
    }

    async getNonObsidianAllActivityEvents() {
      try{
        const allActivity = await this.getAllActivityEvents()
        //console.log(allActivity)
        const allActivityEvents = allActivity.events
        //client中不包含obsidian 的activity
        const filteredArray = allActivityEvents.filter(obj => !obj.extra_data.client?.includes("obsidian")); 
        //console.log(filteredArray)
        return(filteredArray)

      }catch(err){
        console.error('An error occurred:', err);
      }

    }
  
  

    

    filterActivityEvents(events: Event[], options: FilterOptions): Event[] {
      return events.filter(event => 
        (options.event_type ? event.event_type === options.event_type : true) &&
        (options.object_type ? event.object_type === options.object_type : true)
    
        );
    };

    //get completed items activity
    //result  {results:[],next_cursor:null}
    async getCompletedItemsActivity() {
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/api/v1/activities?event_type=completed';
        
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                'Authorization': `Bearer ${accessToken}`
                }
            });
        
            if (!response.ok) {
            throw new Error(`Failed to fetch completed items: ${response.status} ${response.statusText}`);
            }
        
            const data = await response.json();
        
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
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                'Authorization': `Bearer ${accessToken}`
                }
            });
    
            if (!response.ok) {
                throw new Error(`Failed to fetch uncompleted items: ${response.status} ${response.statusText}`);
            }
    
            const data = await response.json();
    
            // API v1 返回格式: { results: [], next_cursor: null }
            // 转换为旧格式: { events: [] }
            return { events: data.results || [] };
        } catch (error) {
            console.error(error);
            throw new Error('Failed to fetch uncompleted items due to network error');
        }
    }
  
  
    //get non-obsidian completed event
    async getNonObsidianCompletedItemsActivity() {
        const accessToken = this.plugin.settings.todoistAPIToken
        const completedItemsActivity = await this.getCompletedItemsActivity()
        const completedItemsActivityEvents = completedItemsActivity.events
        //client中不包含obsidian 的activity
        const filteredArray = completedItemsActivityEvents.filter(obj => {
            const client = obj.extra_data && obj.extra_data.client;
            return !client || !client.includes("obsidian");
        }); 
        return(filteredArray)     
    }
  
  
    //get non-obsidian uncompleted event
    async getNonObsidianUncompletedItemsActivity() {
        const uncompletedItemsActivity = await this.getUncompletedItemsActivity()
        const uncompletedItemsActivityEvents = uncompletedItemsActivity.events
        //client中不包含obsidian 的activity
        const filteredArray = uncompletedItemsActivityEvents.filter(obj => {
            const client = obj.extra_data && obj.extra_data.client;
            return !client || !client.includes("obsidian");
        }); 
        return(filteredArray) 
    }
  
  
    //get updated items activity
    //result  {results:[],next_cursor:null}
    async getUpdatedItemsActivity() {
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/api/v1/activities?event_type=updated';
    
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                'Authorization': `Bearer ${accessToken}`
                }
            });
    
            if (!response.ok) {
                throw new Error(`Failed to fetch updated items: ${response.status} ${response.statusText}`);
            }
    
            const data = await response.json();
    
            // API v1 返回格式: { results: [], next_cursor: null }
            // 转换为旧格式: { events: [] }
            return { events: data.results || [] };
        } catch (error) {
            console.error(error);
            throw new Error('Failed to fetch updated items due to network error');
        }
    }
  
  
    //get non-obsidian updated event
    async  getNonObsidianUpdatedItemsActivity() {
        const updatedItemsActivity = await this.getUpdatedItemsActivity()
        const updatedItemsActivityEvents = updatedItemsActivity.events
        //client中不包含obsidian 的activity
        const filteredArray = updatedItemsActivityEvents.filter(obj => {
          const client = obj.extra_data && obj.extra_data.client;
          return !client || !client.includes("obsidian");
        });
        return(filteredArray)
    }


//get projects activity
    //result  {results:[],next_cursor:null}
    async getProjectsActivity() {
      const accessToken = this.plugin.settings.todoistAPIToken
      const url = 'https://api.todoist.com/api/v1/activities?object_type=project';
      
      try {
          const response = await fetch(url, {
              method: 'GET',
              headers: {
              'Authorization': `Bearer ${accessToken}`
              }
          });
      
          if (!response.ok) {
            throw new Error(`Failed to fetch projects activities: ${response.status} ${response.statusText}`);
          }
      
          const data = await response.json();
      
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

  // Generate temp_id for commands
  private generateTempId(): string {
    return 'temp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
  }

  // Execute Sync API commands
  async executeCommands(commands: any[]): Promise<any> {
    const accessToken = this.plugin.settings.todoistAPIToken;
    const url = 'https://api.todoist.com/api/v1/sync';
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        commands: JSON.stringify(commands)
      })
    };

    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to execute commands: ${response.status} ${response.statusText} - ${errorText}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
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
    throw new Error('Failed to add task: no response');
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

  // Reopen task using Sync API
  async reopenTask(taskId: string): Promise<boolean> {
    const command = {
      type: 'item_reopen',
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
      project_id: task.projectId
    };

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
      const data = await this.getAllResources();
      return data.projects || [];
    } catch (error) {
      console.error('Error getting all projects:', error);
      throw error;
    }
  }

  // Compatible wrapper: GetTaskById
  async GetTaskById(taskId: string): Promise<any> {
    try {
      const data = await this.getAllResources();
      const tasks = data.items || [];
      return tasks.find((t: any) => t.id === taskId);
    } catch (error) {
      console.error('Error getting task by id:', error);
      throw error;
    }
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
      const data = await this.getAllResources();
      let tasks = data.items || [];

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
       
}





















