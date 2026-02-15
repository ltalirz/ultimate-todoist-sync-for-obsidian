import { App} from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";

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
            //const taskAlreadyExists = savedTasks.some((t) => t.id === task.id);
            //if (!taskAlreadyExists) {
             //，使用push方法将字符串插入到Cache对象时，它将被视为一个简单的键值对，其中键是数组的数字索引，而值是该字符串本身。但如果您使用push方法将另一个Cache对象（或数组）插入到Cache对象中，则该对象将成为原始Cache对象的一个嵌套子对象。在这种情况下，键是数字索引，值是嵌套的Cache对象本身。
            //}
            this.plugin.settings.todoistTasksData.tasks.push(task);  
        } catch (error) {
            console.error(`Error appending task to Cache: ${error}`);
        }
    }
      
      
      
      
    //读取指定id的任务
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
            
            const fileTaskMap: Map<string, string[]> = new Map();
            
            for (const file of files) {
                try {
                    const content = await this.app.vault.cachedRead(file);
                    const lines = content.split('\n');
                    const taskIds: string[] = [];
                    
                    for (const line of lines) {
                        // 检查是否包含 #todoist 标签
                        if (line.includes('#todoist')) {
                            // 提取 todoist_id: %%[todoist_id:: xxx]%%
                            const match = line.match(/%%\[todoist_id::\s*(\w+)\]%%/);
                            if (match && match[1]) {
                                taskIds.push(match[1]);
                            }
                        }
                    }
                    
                    if (taskIds.length > 0) {
                        fileTaskMap.set(file.path, taskIds);
                    }
                } catch (error) {
                    console.error(`Error reading file ${file.path}:`, error);
                }
            }

            // Step 4: 处理每个文件的任务
            if (noticeCallback) {
                noticeCallback('Processing tasks...');
            } else {
                console.log('Processing tasks...');
            }
            
            let processedCount = 0;
            const totalTasks = Array.from(fileTaskMap.values())
                .reduce((sum, ids) => sum + ids.length, 0);
            
            for (const [filePath, taskIds] of fileTaskMap.entries()) {
                const validTaskIds: string[] = [];
                
                for (const taskId of taskIds) {
                    try {
                        // 从 Todoist 获取任务详情
                        const task = await this.plugin.todoistRestAPI.getTaskById(taskId);
                        
                        // 添加 path 字段关联到文件
                        (task as any).path = filePath;
                        
                        // 保存到缓存
                        this.appendTaskToCache(task);
                        
                        validTaskIds.push(taskId);
                        processedCount++;
                        
                        // 每处理 10 个任务更新一次 UI
                        if (noticeCallback && processedCount % 10 === 0) {
                            noticeCallback(`Processing ${processedCount}/${totalTasks}...`);
                        }
                    } catch (error) {
                        // 任务在 Todoist 中不存在，跳过
                        console.log(`Task ${taskId} not found in Todoist, skipping...`);
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

            // Step 5: 保存设置
            await this.plugin.saveSettings();
            
            const message = `Cache rebuilt! ${processedCount} tasks processed.`;
            if (noticeCallback) {
                noticeCallback(message);
            } else {
                console.log(message);
            }
            
            return { success: true, tasksProcessed: processedCount };
            
        } catch (error) {
            console.error('Cache rebuild failed:', error);
            const message = `Cache rebuild failed: ${error.message}`;
            if (noticeCallback) {
                noticeCallback(message);
            }
            return { success: false, tasksProcessed: 0 };
        }
    }

}
