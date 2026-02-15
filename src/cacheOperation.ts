import { App} from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";
import { LogAction } from './logOperation';
import { TaskConflict, ConflictResolutionModal } from './conflictModal';

interface Due {
    date?: string;
    [key: string]: any; // allow for additional properties
  }

export class CacheOperation   {
	app:App;
    plugin: UltimateTodoistSyncForObsidian;

	constructor(app:App, plugin: UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
        this.plugin = plugin;
	}

          
      
      
      
    async getFileMetadata(filepath:string) {
        return this.plugin.settings.fileMetadata[filepath] ?? null
    }

    async getFileMetadatas(){
        return this.plugin.settings.fileMetadata ?? null
    }

    async newEmptyFileMetadata(filepath:string){
        const metadatas = this.plugin.settings.fileMetadata
        if(metadatas[filepath]) {
            return
        }
        else{
            metadatas[filepath] = {}
        }
        metadatas[filepath].todoistTasks = [];
        metadatas[filepath].todoistCount = 0;
        // 将更新后的metadatas对象保存回设置对象中
        this.plugin.settings.fileMetadata = metadatas

    }

    async updateFileMetadata(filepath:string,newMetadata) {
        const metadatas = this.plugin.settings.fileMetadata
    
        // 如果元数据对象不存在，则创建一个新的对象并添加到metadatas中
        if (!metadatas[filepath]) {
            metadatas[filepath] = {}
        }
    
        // 更新元数据对象中的属性值
        metadatas[filepath].todoistTasks = newMetadata.todoistTasks;
        metadatas[filepath].todoistCount = newMetadata.todoistCount;
    
        // 将更新后的metadatas对象保存回设置对象中
        this.plugin.settings.fileMetadata = metadatas
        this.plugin.logOperation?.log('CACHE_FILE_METADATA_UPDATED', `Updated file metadata for: ${filepath}`, filepath);
        
    }

    async deleteTaskIdFromMetadata(filepath:string,taskId:string){
        console.log(filepath)
        const metadata = await this.getFileMetadata(filepath)
        console.log(metadata)
        const newTodoistTasks = metadata.todoistTasks.filter(function(element){
            return element !== taskId
        })
        const newTodoistCount = metadata.todoistCount - 1
        let newMetadata = {}
        newMetadata.todoistTasks = newTodoistTasks
        newMetadata.todoistCount = newTodoistCount
        console.log(`new metadata ${newMetadata}`)
        

    }

    //delete filepath from filemetadata
    async deleteFilepathFromMetadata(filepath:string){
        Reflect.deleteProperty(this.plugin.settings.fileMetadata, filepath);
        this.plugin.saveSettings()
        this.plugin.logOperation?.log('CACHE_FILE_METADATA_DELETED', `Deleted file metadata for: ${filepath}`, filepath);
        console.log(`${filepath} is deleted from file metadatas.`)
    }


    //Check errors in filemata where the filepath is incorrect.
    async checkFileMetadata(){
        const metadatas =  await this.getFileMetadatas()
        for (const key in metadatas) {
            let filepath = key
            const value = metadatas[key];
            let file = this.app.vault.getAbstractFileByPath(key)
            if(!file && (value.todoistTasks?.length === 0 || !value.todoistTasks)){
                console.log(`${key} is not existed and metadata is empty.`)
                await this.deleteFilepathFromMetadata(key)
                continue
            }
            if(value.todoistTasks?.length === 0 || !value.todoistTasks){
                //todo 
                //delelte empty metadata
                continue
            }
            //check if file exist
            
            if(!file){
                //search new filepath
                console.log(`file ${filepath} is not exist`) 
                const todoistId1 = value.todoistTasks[0]
                console.log(todoistId1)
                const searchResult = await this.plugin.fileOperation.searchFilepathsByTaskidInVault(todoistId1)
                console.log(`new file path is`)
                console.log(searchResult)

                //update metadata
                await this.updateRenamedFilePath(filepath,searchResult)
                this.plugin.saveSettings()

            }


            //const fileContent = await this.app.vault.read(file)
            //check if file include all tasks


            /*
            value.todoistTasks.forEach(async(taskId) => {
                const taskObject = await this.plugin.cacheOperation.loadTaskFromCacheyID(taskId)


            });
            */
          }
    
    }

    getDefaultProjectNameForFilepath(filepath:string){
        const metadatas = this.plugin.settings.fileMetadata
        if (!metadatas[filepath] || metadatas[filepath].defaultProjectId === undefined) {
            return this.plugin.settings.defaultProjectName
        }
        else{
            const defaultProjectId = metadatas[filepath].defaultProjectId
            const defaultProjectName = this.getProjectNameByIdFromCache(defaultProjectId)
            return defaultProjectName
        }
    }


    getDefaultProjectIdForFilepath(filepath:string){
        const metadatas = this.plugin.settings.fileMetadata
        if (!metadatas[filepath] || metadatas[filepath].defaultProjectId === undefined) {
            return this.plugin.settings.defaultProjectId
        }
        else{
            const defaultProjectId = metadatas[filepath].defaultProjectId
            return defaultProjectId
        }
    }

    setDefaultProjectIdForFilepath(filepath:string,defaultProjectId:string){
        const metadatas = this.plugin.settings.fileMetadata
        if (!metadatas[filepath]) {
            metadatas[filepath] = {}
        }
        metadatas[filepath].defaultProjectId = defaultProjectId
    
        // 将更新后的metadatas对象保存回设置对象中
        this.plugin.settings.fileMetadata = metadatas

    }

      
    // 从 Cache读取所有task
    loadTasksFromCache() {
    try {
        const savedTasks = this.plugin.settings.todoistTasksData.tasks
        return savedTasks;
    } catch (error) {
        console.error(`Error loading tasks from Cache: ${error}`);
        return [];
    }
    }
      

    // 覆盖保存所有task到cache
    saveTasksToCache(newTasks) {
        try {
            this.plugin.settings.todoistTasksData.tasks = newTasks
            
        } catch (error) {
            console.error(`Error saving tasks to Cache: ${error}`);
            return false;
        }
    }
      
      
      
      
    // append event 到 Cache
    appendEventToCache(event:Object[]) {
        try {
            this.plugin.settings.todoistTasksData.events.push(event)
        } catch (error) {
            console.error(`Error append event to Cache: ${error}`);
        }
    }

    // append events 到 Cache
    appendEventsToCache(events:Object[]) {
        try {
            this.plugin.settings.todoistTasksData.events.push(...events)
        } catch (error) {
            console.error(`Error append events to Cache: ${error}`);
        }
    }
      
      
    // 从 Cache 文件中读取所有events
    loadEventsFromCache() {
    try {

            const savedEvents = this.plugin.settings.todoistTasksData.events
            return savedEvents;
        } catch (error) {
            console.error(`Error loading events from Cache: ${error}`);
        }
    }


      
    // 追加到 Cache 文件
    appendTaskToCache(task) {
        try {
            if(task === null){
                return
            }
            const savedTasks = this.plugin.settings.todoistTasksData.tasks
            this.plugin.settings.todoistTasksData.tasks.push(task);
            this.plugin.logOperation?.log('CACHE_TASK_ADDED', `Added task to cache: ${task.content || task.id}`, task.path, task.id);
        } catch (error) {
            console.error(`Error appending task to Cache: ${error}`);
        }
    }
    loadTaskFromCacheyID(taskId) {
        try {

            const savedTasks = this.plugin.settings.todoistTasksData.tasks
            //console.log(savedTasks)
            const savedTask = savedTasks.find((t) => t.id === taskId);
            //console.log(savedTask)
            return(savedTask)
        } catch (error) {
            console.error(`Error finding task from Cache: ${error}`);
            return [];
        }
    }
      
    //覆盖update指定id的task
    updateTaskToCacheByID(task) {
        try {
            //删除就的task
            this.deleteTaskFromCache(task.id)
            //添加新的task
            this.appendTaskToCache(task)
            this.plugin.logOperation?.log('CACHE_TASK_UPDATED', `Updated task in cache: ${task.content || task.id}`, task.path, task.id);
        } catch (error) {
            console.error(`Error updating task to Cache: ${error}`);
            return [];
        }
    }

    //due 的结构  {date: "2025-02-25",isRecurring: false,lang: "en",string: "2025-02-25"}



    modifyTaskToCacheByID(taskId: string, { content, due }: { content?: string, due?: Due }): void {
        try {
          const savedTasks = this.plugin.settings.todoistTasksData.tasks;
          const taskIndex = savedTasks.findIndex((task) => task.id === taskId);
      
          if (taskIndex !== -1) {
            const updatedTask = { ...savedTasks[taskIndex] };
            
            if (content !== undefined) {
              updatedTask.content = content;
            }
      
            if (due !== undefined) {
              if (due === null) {
                updatedTask.due = null;
              } else {
                updatedTask.due = due;
              }
            }
      
            savedTasks[taskIndex] = updatedTask;
      
            this.plugin.settings.todoistTasksData.tasks = savedTasks;
          } else {
            throw new Error(`Task with ID ${taskId} not found in cache.`);
          }
        } catch (error) {
          // Handle the error appropriately, e.g. by logging it or re-throwing it.
        }
      }
      
      
      //open a task status
    reopenTaskToCacheByID(taskId:string) {
        try {
            const savedTasks = this.plugin.settings.todoistTasksData.tasks

        
            // 遍历数组以查找具有指定 ID 的项
            for (let i = 0; i < savedTasks.length; i++) {
            if (savedTasks[i].id === taskId) {
                // 修改对象的属性
                savedTasks[i].isCompleted = false;
                break; // 找到并修改了该项，跳出循环
            }
            }
            this.plugin.settings.todoistTasksData.tasks = savedTasks
            this.plugin.logOperation?.log('CACHE_TASK_REOPENED', `Reopened task in cache: ${taskId}`, undefined, taskId);
        
        } catch (error) {
            console.error(`Error open task to Cache file: ${error}`);
            return [];
        }
    }
      
      
      
    //close a task status
    closeTaskToCacheByID(taskId:string):Promise<void> {
        try {
            const savedTasks = this.plugin.settings.todoistTasksData.tasks
        
            // 遍历数组以查找具有指定 ID 的项
            for (let i = 0; i < savedTasks.length; i++) {
            if (savedTasks[i].id === taskId) {
                // 修改对象的属性
                savedTasks[i].isCompleted = true;
                break; // 找到并修改了该项，跳出循环
            }
            }
            this.plugin.settings.todoistTasksData.tasks = savedTasks
            this.plugin.logOperation?.log('CACHE_TASK_COMPLETED', `Completed task in cache: ${taskId}`, undefined, taskId);
        
        } catch (error) {
            console.error(`Error close task to Cache file: ${error}`);
            throw error; // 抛出错误使调用方能够捕获并处理它
        }
    }
      
      
    // 通过 ID 删除任务
    deleteTaskFromCache(taskId) {
        try {
        const savedTasks = this.plugin.settings.todoistTasksData.tasks
        const newSavedTasks = savedTasks.filter((t) => t.id !== taskId);
        this.plugin.settings.todoistTasksData.tasks = newSavedTasks
        this.plugin.logOperation?.log('CACHE_TASK_DELETED', `Deleted task from cache: ${taskId}`, undefined, taskId);
        } catch (error) {
        console.error(`Error deleting task from Cache file: ${error}`);
        }
    }
      
      
      
      
      
    // 通过 ID 数组 删除task
    deleteTaskFromCacheByIDs(deletedTaskIds) {
        try {
            const savedTasks = this.plugin.settings.todoistTasksData.tasks
            const newSavedTasks = savedTasks.filter((t) => !deletedTaskIds.includes(t.id))
            this.plugin.settings.todoistTasksData.tasks = newSavedTasks
            this.plugin.logOperation?.log('CACHE_TASK_DELETED', `Deleted ${deletedTaskIds.length} tasks from cache`, undefined, deletedTaskIds.join(', '));
        } catch (error) {
            console.error(`Error deleting task from Cache : ${error}`);
        }
    }
      
      
    //通过 name 查找 project id
    getProjectIdByNameFromCache(projectName:string) {
        try {
        const savedProjects = this.plugin.settings.todoistTasksData.projects
        const targetProject = savedProjects.find(obj => obj.name === projectName);
        const projectId = targetProject ? targetProject.id : null;
        return(projectId)
        } catch (error) {
        console.error(`Error finding project from Cache file: ${error}`);
        return(false)
        }
    }


     
    getProjectNameByIdFromCache(projectId:string) {
        try {
        const savedProjects = this.plugin.settings.todoistTasksData.projects
        const targetProject = savedProjects.find(obj => obj.id === projectId);
        const projectName = targetProject ? targetProject.name : null;
        return(projectName)
        } catch (error) {
        console.error(`Error finding project from Cache file: ${error}`);
        return(false)
        }
    }
      


    //save projects data to json file
    async saveProjectsToCache() {
        try{
                //get projects
            const projects = await this.plugin.todoistRestAPI.GetAllProjects()
            if(!projects){
                return false
            }
        
            //save to json
            this.plugin.settings.todoistTasksData.projects = projects
            this.plugin.logOperation?.log('PROJECT_UPDATED', `Updated ${projects.length} projects in cache`);

            return true

        }catch(error){
            return false
            console.log(`error downloading projects: ${error}`)

    }
    
    }


    async updateRenamedFilePath(oldpath:string,newpath:string){
        try{
            console.log(`oldpath is ${oldpath}`)
            console.log(`newpath is ${newpath}`)
            const savedTask = await this.loadTasksFromCache()
            //console.log(savedTask)
            const newTasks = savedTask.map(obj => {
                if (obj.path === oldpath) {
                  return { ...obj, path: newpath };
                }else {
                    return obj;
                }
            })
            //console.log(newTasks)
            await this.saveTasksToCache(newTasks)

            //update filepath
            const fileMetadatas = this.plugin.settings.fileMetadata
            fileMetadatas[newpath] = fileMetadatas[oldpath]
            delete fileMetadatas[oldpath]
            this.plugin.settings.fileMetadata = fileMetadatas

            this.plugin.logOperation?.log('CACHE_RENAMED', `Renamed file path from ${oldpath} to ${newpath}`, newpath);

        }catch(error){
            console.log(`Error updating renamed file path to cache: ${error}`)
        }


    }

    async rebuildCache(noticeCallback?: (message: string) => void): Promise<{ success: boolean; tasksProcessed: number }> {
        try {
            if (noticeCallback) {
                noticeCallback('Starting cache rebuild...');
            } else {
                console.log('Starting cache rebuild...');
            }
            this.plugin.logOperation?.log('CACHE_REBUILT', 'Starting cache rebuild...');

            // Step 1: 清空现有缓存
            this.plugin.settings.todoistTasksData = {
                projects: [],
                tasks: [],
                events: []
            };
            this.plugin.settings.fileMetadata = {};

            // Step 2: 从 Todoist 获取项目列表
            if (noticeCallback) {
                noticeCallback('Fetching projects from Todoist...');
            } else {
                console.log('Fetching projects from Todoist...');
            }
            const projects = await this.plugin.todoistRestAPI.GetAllProjects();
            if (!projects) {
                throw new Error('Failed to fetch projects from Todoist');
            }
            this.plugin.settings.todoistTasksData.projects = projects;

            // Step 3: 扫描 Vault 中的所有 .md 文件
            if (noticeCallback) {
                noticeCallback('Scanning vault for tasks...');
            } else {
                console.log('Scanning vault for tasks...');
            }
            
            const files = this.app.vault.getFiles()
                .filter(f => f.extension === 'md');
            
            const fileTaskMap: Map<string, { taskId: string; lineNumber: number; content: string }[]> = new Map();
            
            for (const file of files) {
                try {
                    const content = await this.app.vault.cachedRead(file);
                    const lines = content.split('\n');
                    
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        // 检查是否包含 #todoist 标签
                        if (line.includes('#todoist')) {
                            // 提取 todoist_id: %%[todoist_id:: xxx]%%
                            const match = line.match(/%%\[todoist_id::\s*(\w+)\]%%/);
                            if (match && match[1]) {
                                const taskId = match[1];
                                // 提取任务内容（去掉 checkbox 和 metadata）
                                const taskContent = this.extractTaskContent(line);
                                
                                if (!fileTaskMap.has(file.path)) {
                                    fileTaskMap.set(file.path, []);
                                }
                                fileTaskMap.get(file.path)!.push({
                                    taskId,
                                    lineNumber: i,
                                    content: taskContent
                                });
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Error reading file ${file.path}:`, error);
                }
            }

            // Step 4: 处理每个文件的任务，检测冲突
            if (noticeCallback) {
                noticeCallback('Processing tasks and detecting conflicts...');
            } else {
                console.log('Processing tasks and detecting conflicts...');
            }
            
            const conflicts: TaskConflict[] = [];
            let processedCount = 0;
            const totalTasks = Array.from(fileTaskMap.values())
                .reduce((sum, tasks) => sum + tasks.length, 0);
            
            for (const [filePath, fileTasks] of fileTaskMap.entries()) {
                const validTaskIds: string[] = [];
                
                for (const taskInfo of fileTasks) {
                    try {
                        // 从 Todoist 获取任务详情
                        const task = await this.plugin.todoistRestAPI.getTaskById(taskInfo.taskId);
                        
                        // 比较内容是否一致
                        const todoistContent = task.content || '';
                        const obsidianContent = taskInfo.content;
                        
                        if (obsidianContent.trim() !== todoistContent.trim()) {
                            // 检测到冲突
                            conflicts.push({
                                taskId: taskInfo.taskId,
                                filePath: filePath,
                                obsidianContent: obsidianContent,
                                todoistContent: todoistContent,
                                lineNumber: taskInfo.lineNumber
                            });
                        }
                        
                        // 添加 path 字段关联到文件
                        (task as any).path = filePath;
                        
                        // 保存到缓存
                        this.appendTaskToCache(task);
                        
                        validTaskIds.push(taskInfo.taskId);
                        processedCount++;
                        
                        // 每处理 10 个任务更新一次 UI
                        if (noticeCallback && processedCount % 10 === 0) {
                            noticeCallback(`Processing ${processedCount}/${totalTasks}...`);
                        }
                    } catch (error) {
                        // 任务在 Todoist 中不存在，跳过
                        console.log(`Task ${taskInfo.taskId} not found in Todoist, skipping...`);
                    }
                }
                
                // 更新 fileMetadata
                if (validTaskIds.length > 0) {
                    this.plugin.settings.fileMetadata[filePath] = {
                        todoistTasks: validTaskIds,
                        todoistCount: validTaskIds.length
                    };
                }
            }

            // Step 5: 如果有冲突，弹出窗口让用户选择
            if (conflicts.length > 0) {
                if (noticeCallback) {
                    noticeCallback(`Found ${conflicts.length} conflicts. Please resolve in dialog...`);
                }
                
                await new Promise<void>((resolve) => {
                    new ConflictResolutionModal(
                        this.app,
                        this.plugin,
                        conflicts,
                        async (resolutions) => {
                            await this.resolveConflicts(resolutions, conflicts);
                            resolve();
                        }
                    );
                });
            }
            
            // Step 6: 保存设置
            await this.plugin.saveSettings();
            
            const conflictMsg = conflicts.length > 0 ? ` (${conflicts.length} conflicts resolved)` : '';
            const message = `Cache rebuilt! ${processedCount} tasks processed.${conflictMsg}`;
            this.plugin.logOperation?.log('CACHE_REBUILT', `Cache rebuilt successfully! ${processedCount} tasks processed.${conflictMsg}`);
            if (noticeCallback) {
                noticeCallback(message);
            } else {
                console.log(message);
            }
            
            return { success: true, tasksProcessed: processedCount };
            
        } catch (error) {
            console.error('Cache rebuild failed:', error);
            this.plugin.logOperation?.log('CACHE_REBUILT', `Cache rebuild failed: ${(error as Error).message}`);
            const message = `Cache rebuild failed: ${(error as Error).message}`;
            if (noticeCallback) {
                noticeCallback(message);
            }
            return { success: false, tasksProcessed: 0 };
        }
    }

    private extractTaskContent(line: string): string {
        // 去掉 checkbox 标记 [- ] 或 [x]
        let content = line.replace(/^(\s*)([-*])\s+\[(x|X| )\]\s*/, '');
        // 去掉 #todoist 标签
        content = content.replace(/#todoist/g, '').trim();
        // 去掉 todoist_id 元数据
        content = content.replace(/%%\[todoist_id::\s*\w+\]%%/g, '').trim();
        // 去掉 link
        content = content.replace(/\[link\]\([^)]+\)/g, '').trim();
        // 去掉日期
        // eslint-disable-next-line no-misleading-character-class
        content = content.replace(/[🗓️📅📆🗓]\s*\d{4}-\d{2}-\d{2}/gu, '').trim();
        // 去掉优先级 !!1 !!2 !!3 !!4
        content = content.replace(/\s!![1-4]\s/g, ' ').trim();
        
        return content;
    }

    private async resolveConflicts(resolutions: Map<string, ConflictResolution>, conflicts: TaskConflict[]): Promise<void> {
        for (const conflict of conflicts) {
            const resolution = resolutions.get(conflict.taskId);
            
            if (resolution === 'obsidian') {
                // 用 Obsidian 内容更新 Todoist
                try {
                    await this.plugin.todoistRestAPI.UpdateTask(conflict.taskId, {
                        content: conflict.obsidianContent
                    });
                    this.plugin.logOperation?.log('TODOIST_TASK_UPDATED', `Updated task ${conflict.taskId} with Obsidian content`, conflict.filePath, conflict.taskId);
                } catch (error) {
                    console.error(`Failed to update task ${conflict.taskId}:`, error);
                }
            } else if (resolution === 'todoist') {
                // 用 Todoist 内容更新 Obsidian 文件
                try {
                    const file = this.app.vault.getAbstractFileByPath(conflict.filePath);
                    if (file) {
                        const content = await this.app.vault.read(file);
                        const lines = content.split('\n');
                        
                        // 找到对应行并替换内容
                        if (lines[conflict.lineNumber]) {
                            const oldContent = this.extractTaskContent(lines[conflict.lineNumber]);
                            lines[conflict.lineNumber] = lines[conflict.lineNumber].replace(
                                oldContent,
                                conflict.todoistContent
                            );
                            await this.plugin.backupOperation?.backupFile(conflict.filePath);
                            await this.app.vault.modify(file, lines.join('\n'));
                            this.plugin.logOperation?.log('FILE_TASK_CONTENT_SYNCED', `Synced task ${conflict.taskId} from Todoist to file`, conflict.filePath, conflict.taskId);
                        }
                    }
                } catch (error) {
                    console.error(`Failed to update file ${conflict.filePath}:`, error);
                }
            }
            // 如果是 skip，则不做任何操作
        }
    }

}
