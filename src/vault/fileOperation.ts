import { App} from 'obsidian';
import UltimateTodoistSyncForObsidian from "../../main";

export interface VaultTask {
    taskId: string;
    content: string;
    isCompleted: boolean;
    filePath: string;
    lineNumber: number;
    labels: string[];
}

export interface VaultTaskWithoutId {
    content: string;
    isCompleted: boolean;
    filePath: string;
    lineNumber: number;
    labels: string[];
}

export interface TodoistTask {
    taskId: string;
    content: string;
    checked: boolean;
    dueDate?: string;
    priority: number;
    projectId: string;
    labels: string[];
}

export class FileOperation   {
	app:App;
    plugin: UltimateTodoistSyncForObsidian;


	constructor(app:App, plugin:UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
        this.plugin = plugin;

	}
    /*
    async getFrontMatter(file:TFile): Promise<FrontMatter | null> {
        return new Promise((resolve) => {
          this.app.fileManager.processFrontMatter(file, (frontMatter) => {
            resolve(frontMatter);
          });
        });
    }
    */
    



    /*
    async updateFrontMatter(
    file:TFile,
    updater: (frontMatter: FrontMatter) => void
    ): Promise<void> {
        //console.log(`prepare to update front matter`)
        this.app.fileManager.processFrontMatter(file, (frontMatter) => {
        if (frontMatter !== null) {
        const updatedFrontMatter = { ...frontMatter } as FrontMatter;
        updater(updatedFrontMatter);
        this.app.fileManager.processFrontMatter(file, (newFrontMatter) => {
            if (newFrontMatter !== null) {
            newFrontMatter.todoistTasks = updatedFrontMatter.todoistTasks;
            newFrontMatter.todoistCount = updatedFrontMatter.todoistCount;
            }
        });
        }
    });
    }
    */


    
          

     // 完成一个任务，将其标记为已完成
    async completeTaskInTheFile(taskId: string) {
        // 获取任务文件路径
        const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskId)
        if (!taskMapping) {
            console.error(`Task ${taskId} not found in taskFileMapping`);
            return;
        }
        const filepath = taskMapping.filePath
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
            lines[i] = line.replace('[ ]', '[x]')
            modified = true
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        await this.plugin.backupOperation?.backupFile(filepath);
        await this.app.vault.modify(file, newContent)
        this.plugin.logOperation?.log('FILE_TASK_COMPLETED', `Completed task in file: ${taskId}`, filepath, taskId);
        }
    }
  
    // uncheck 已完成的任务，
    async uncompleteTaskInTheFile(taskId: string) {
        // 获取任务文件路径
        const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskId)
        if (!taskMapping) {
            console.error(`Task ${taskId} not found in taskFileMapping`);
            return;
        }
        const filepath = taskMapping.filePath
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
            lines[i] = line.replace(/- \[(x|X)\]/g, '- [ ]');
            modified = true
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        await this.plugin.backupOperation?.backupFile(filepath);
        await this.app.vault.modify(file, newContent)
        this.plugin.logOperation?.log('FILE_TASK_UNCOMPLETED', `Reopened task in file: ${taskId}`, filepath, taskId);
        }
    }

    //add #todoist at the end of task line, if full vault sync enabled
    async addTodoistTagToFile(filepath: string) {    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if(!this.plugin.taskParser.isMarkdownTask(line)){
                //console.log(line)
                //console.log("It is not a markdown task.")
                continue;
            }
            //if content is empty
            if(this.plugin.taskParser.getTaskContentFromLineText(line) == ""){
                //console.log("Line content is empty")
                continue;
            }
            if (!this.plugin.taskParser.hasTodoistId(line) && !this.plugin.taskParser.hasTodoistTag(line)) {
                //console.log(line)
                //console.log('prepare to add todoist tag')
                const newLine = this.plugin.taskParser.addTodoistTag(line);
                //console.log(newLine)
                lines[i] = newLine
                modified = true
            }
        }
        
        if (modified) {
            console.log(`New task found in files ${filepath}`)
            const newContent = lines.join('\n')
            //console.log(newContent)
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.app.vault.modify(file, newContent)
            this.plugin.logOperation?.log('FILE_TODOIST_TAG_ADDED', `Added todoist tag to file: ${filepath}`, filepath);

        }
    }



    //add todoist at the line
    async addTodoistLinkToFile(filepath: string) {    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (this.plugin.taskParser.hasTodoistId(line) && this.plugin.taskParser.hasTodoistTag(line)) {
                if(this.plugin.taskParser.hasTodoistLink(line)){
                    return
                }
                console.log(line)
                //console.log('prepare to add todoist link')
                const taskID = this.plugin.taskParser.getTodoistIdFromLineText(line)
                const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskID)
                if (!taskMapping) {
                    console.error(`Task ${taskID} not found in taskFileMapping`);
                    continue;
                }
                const todoistTask = await this.plugin.todoistSyncAPI.GetTaskById(taskID)
                const todoistLink = todoistTask?.url || ''
                const link = `[link](${todoistLink})`
                const newLine = this.plugin.taskParser.addTodoistLink(line,link)
                console.log(newLine)
                lines[i] = newLine
                modified = true
            }else{
                continue
            }
        }
        
        if (modified) {
            const newContent = lines.join('\n')
            //console.log(newContent)
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.app.vault.modify(file, newContent)



        }
    }


    // sync updated task content  to file
    async syncUpdatedTaskContentToTheFile(evt:Object) {
        const taskId = evt.object_id
        // 获取任务文件路径
        const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskId)
        if (!taskMapping) {
            console.error(`Task ${taskId} not found in taskFileMapping`);
            return;
        }
        const filepath = taskMapping.filePath
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
            const oldTaskContent = this.plugin.taskParser.getTaskContentFromLineText(line)
            const newTaskContent = evt.extra_data.content

            lines[i] = line.replace(oldTaskContent, newTaskContent)
            modified = true
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        //console.log(newContent)
        await this.plugin.backupOperation?.backupFile(filepath);
        await this.app.vault.modify(file, newContent)
        this.plugin.logOperation?.log('FILE_TASK_CONTENT_SYNCED', `Synced task content from Todoist: ${taskId}`, filepath, taskId);
        }
        
    }

    // sync updated task due date  to the file
    async syncUpdatedTaskDueDateToTheFile(evt:Object) {
        const taskId = evt.object_id
        // 获取任务文件路径
        const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskId)
        if (!taskMapping) {
            console.error(`Task ${taskId} not found in taskFileMapping`);
            return;
        }
        const filepath = taskMapping.filePath
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
            const oldTaskDueDate = this.plugin.taskParser.getDueDateFromLineText(line) || ""
            const newTaskDueDate = this.plugin.taskParser.ISOStringToLocalDateString(evt.extra_data.due_date) || ""
            
            //console.log(`${taskId} duedate is updated`)
            console.log(oldTaskDueDate)
            console.log(newTaskDueDate)
            if(oldTaskDueDate === ""){
                //console.log(this.plugin.taskParser.insertDueDateBeforeTodoist(line,newTaskDueDate))
                lines[i] = this.plugin.taskParser.insertDueDateBeforeTodoist(line,newTaskDueDate)
                modified = true

            }
            else if(newTaskDueDate === ""){
                //remove 日期from text
                const regexRemoveDate = /(🗓️|📅|📆|🗓)\s?\d{4}-\d{2}-\d{2}/; //匹配日期🗓️2023-03-07"
                lines[i] = line.replace(regexRemoveDate,"")
                modified = true
            }
            else{

                lines[i] = line.replace(oldTaskDueDate, newTaskDueDate)
                modified = true
            }
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        //console.log(newContent)
        await this.plugin.backupOperation?.backupFile(filepath);
        await this.app.vault.modify(file, newContent)
        this.plugin.logOperation?.log('FILE_TASK_DUEDATE_SYNCED', `Synced task due date from Todoist: ${taskId}`, filepath, taskId);
        }
        
    }


    // sync new task note to file
    async syncAddedTaskNoteToTheFile(evt:Object) {


        const taskId = evt.parent_item_id
        const note = evt.extra_data.content
        const datetime = this.plugin.taskParser.ISOStringToLocalDatetimeString(evt.event_date)
        // 获取任务文件路径
        const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskId)
        if (!taskMapping) {
            console.error(`Task ${taskId} not found in taskFileMapping`);
            return;
        }
        const filepath = taskMapping.filePath
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
            const indent = '\t'.repeat(line.length - line.trimStart().length + 1);
            const noteLine = `${indent}- ${datetime} ${note}`;
            lines.splice(i + 1, 0, noteLine);
            modified = true
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        //console.log(newContent)
        await this.plugin.backupOperation?.backupFile(filepath);
        await this.app.vault.modify(file, newContent)
        this.plugin.logOperation?.log('FILE_TASK_NOTE_ADDED', `Synced task note from Todoist: ${taskId}`, filepath, taskId);
        }
        
    }


    async syncTaskContentToFile(taskId: string, newContent: string): Promise<boolean> {
        const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskId);
        if (!taskMapping) return false;
        const filepath = taskMapping.filePath;

        const file = this.app.vault.getAbstractFileByPath(filepath);
        const fileContent = await this.app.vault.read(file);
        const lines = fileContent.split('\n');
        let modified = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
                const oldContent = this.plugin.taskParser.getTaskContentFromLineText(line);
                if (oldContent && oldContent !== newContent) {
                    lines[i] = line.replace(oldContent, newContent);
                    modified = true;
                }
                break;
            }
        }

        if (modified) {
            const newFileContent = lines.join('\n');
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.app.vault.modify(file, newFileContent);
            this.plugin.logOperation?.log('FILE_TASK_CONTENT_SYNCED', `Synced content from Todoist: ${taskId}`, filepath, taskId);
        }
        return modified;
    }

    async syncTaskDueDateToFile(taskId: string, newDueDate: string): Promise<boolean> {
        const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskId);
        if (!taskMapping) return false;
        const filepath = taskMapping.filePath;

        const file = this.app.vault.getAbstractFileByPath(filepath);
        const fileContent = await this.app.vault.read(file);
        const lines = fileContent.split('\n');
        let modified = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
                const oldDueDate = this.plugin.taskParser.getDueDateFromLineText(line) || "";
                const localDueDate = this.plugin.taskParser.ISOStringToLocalDateString(newDueDate) || "";

                if (oldDueDate === localDueDate) break;

                if (oldDueDate === "" && localDueDate !== "") {
                    lines[i] = this.plugin.taskParser.insertDueDateBeforeTodoist(line, localDueDate);
                    modified = true;
                } else if (localDueDate === "") {
                    const regexRemoveDate = /(🗓️|📅|📆|🗓)\s?\d{4}-\d{2}-\d{2}/;
                    lines[i] = line.replace(regexRemoveDate, "");
                    modified = true;
                } else {
                    lines[i] = line.replace(oldDueDate, localDueDate);
                    modified = true;
                }
                break;
            }
        }

        if (modified) {
            const newFileContent = lines.join('\n');
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.app.vault.modify(file, newFileContent);
            this.plugin.logOperation?.log('FILE_TASK_DUEDATE_SYNCED', `Synced due date from Todoist: ${taskId}`, filepath, taskId);
        }
        return modified;
    }

    async syncTaskNoteToFile(taskId: string, noteContent: string, noteDate: string): Promise<boolean> {
        const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskId);
        if (!taskMapping) return false;
        const filepath = taskMapping.filePath;

        const file = this.app.vault.getAbstractFileByPath(filepath);
        const fileContent = await this.app.vault.read(file);
        const lines = fileContent.split('\n');
        let modified = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
                const indent = '\t'.repeat(line.length - line.trimStart().length + 1);
                const noteLine = `${indent}- ${noteDate} ${noteContent}`;
                // skip if note already exists in next lines
                if (i + 1 < lines.length && lines[i + 1].includes(noteContent)) break;
                lines.splice(i + 1, 0, noteLine);
                modified = true;
                break;
            }
        }

        if (modified) {
            const newFileContent = lines.join('\n');
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.app.vault.modify(file, newFileContent);
            this.plugin.logOperation?.log('FILE_TASK_NOTE_ADDED', `Synced note from Todoist: ${taskId}`, filepath, taskId);
        }
        return modified;
    }

    //避免使用该方式，通过view可以获得实时更新的value
    async readContentFromFilePath(filepath:string){
        try {
            const file = this.app.vault.getAbstractFileByPath(filepath);
            const content = await this.app.vault.read(file);
            return content
        } catch (error) {
            console.error(`Error loading content from ${filepath}: ${error}`);
            return false;
        }
    }

    //get line text from file path
    //请使用 view.editor.getLine，read 方法有延迟
    async getLineTextFromFilePath(filepath:string,lineNumber:string) {

        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        return(lines[lineNumber])
    }
  
    //search todoist_id by content
    async searchTodoistIdFromFilePath(filepath: string, searchTerm: string): Promise<string | null> {
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const fileContent = await this.app.vault.read(file)
        const fileLines = fileContent.split('\n');
        let todoistId: string | null = null;
    
        for (let i = 0; i < fileLines.length; i++) {
        const line = fileLines[i];
    
        if (line.includes(searchTerm)) {
            const regexResult = /\[todoist_id::\s*(\w+)\]/.exec(line);
    
            if (regexResult) {
            todoistId = regexResult[1];
            }
    
            break;
        }
        }
    
        return todoistId;
    }

    //get all files in the vault
    async getAllFilesInTheVault(){
        const files = this.app.vault.getFiles()
        return(files)
    }

    //search filepath by taskid in vault
    async searchFilepathsByTaskidInVault(taskId:string){
        console.log(`preprare to search task ${taskId}`)
        const files = await this.getAllFilesInTheVault()
        //console.log(files)
        const tasks = files.map(async (file) => {
            if (!this.isMarkdownFile(file.path)) {
                return;
            }
            const fileContent = await this.app.vault.cachedRead(file);
            if (fileContent.includes(taskId)) {
                return file.path;
            }
        });
    
        const results = await Promise.all(tasks);
        const filePaths = results.filter((filePath) => filePath !== undefined);
        return filePaths[0] || null;
        //return filePaths || null
    }


    isMarkdownFile(filename:string) {
        // 获取文件名的扩展名
        let extension = filename.split('.').pop();
      
        // 将扩展名转换为小写（Markdown文件的扩展名通常是.md）
        extension = extension.toLowerCase();
      
        // 判断扩展名是否为.md
        if (extension === 'md') {
          return true;
        } else {
          return false;
        }
      }

    /**
     * Update task ID in vault file (for legacy ID conversion)
     */
    async updateTaskIdInVault(
        filePath: string, 
        lineNumber: number, 
        oldId: string, 
        newId: string
    ): Promise<void> {
        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!file) {
                console.error(`[updateTaskIdInVault] File not found: ${filePath}`);
                console.log(filePath)
                return;
            }
            
            const content = await this.app.vault.read(file);
            const lines = content.split('\n');
            
            if (lineNumber >= lines.length) {
                console.error(`[updateTaskIdInVault] Line ${lineNumber} out of range in ${filePath}`);
                return;
            }

            let line = lines[lineNumber];
            let hasChanges = false;
            
            // 1. Replace todoist_id metadata: %%[todoist_id:: oldId]%% -> %%[todoist_id:: newId]%%
            const oldIdPattern = new RegExp(`%%\\[todoist_id::\\s*${oldId}\\]%%`, 'g');
            if (oldIdPattern.test(line)) {
                line = line.replace(oldIdPattern, `%%[todoist_id:: ${newId}]%%`);
                hasChanges = true;
            }
            
            // 2. Replace App URI: todoist://task?id=oldId -> todoist://task?id=newId
            const oldAppUriPattern = new RegExp(`todoist://task\\?id=${oldId}`, 'g');
            if (oldAppUriPattern.test(line)) {
                line = line.replace(oldAppUriPattern, `todoist://task?id=${newId}`);
                hasChanges = true;
            }
            
            // 3. Replace Web URL: https://todoist.com/app/task/oldId -> https://todoist.com/app/task/newId
            const oldWebUrlPattern = new RegExp(`https://todoist\\.com/app/task/${oldId}`, 'g');
            if (oldWebUrlPattern.test(line)) {
                line = line.replace(oldWebUrlPattern, `https://todoist.com/app/task/${newId}`);
                hasChanges = true;
            }
            
            if (!hasChanges) {
                console.warn(`[updateTaskIdInVault] No ID patterns found in line ${lineNumber} of ${filePath}`);
                return;
            }
            
            lines[lineNumber] = line;
            
            await this.plugin.backupOperation?.backupFile(filePath);
            await this.app.vault.modify(file, lines.join('\n'));
            
            this.plugin.logOperation?.log(
                'FILE_TASK_ID_UPDATED', 
                `Updated task ID ${oldId} -> ${newId}`, 
                filePath, 
                newId
            );
            console.log(`[updateTaskIdInVault] Updated task ID ${oldId} -> ${newId} in ${filePath}`);
        } catch (error) {
            console.error(`[updateTaskIdInVault] Failed to update task ID in vault:`, error);
        }
    }

    /**
     * 扫描 Vault 中的所有 Todoist 任务
     * 
     * 扫描逻辑：
     * 1. 获取所有 .md 文件
     * 2. 遍历每个文件的每一行
     * 3. 查找包含 #todoist 标签的行
     * 4. 提取 todoist_id 元数据作为任务 ID
     * 5. 使用 taskParser 提取任务内容
     * 
     * @returns {
     *   tasksWithId: Map<string, VaultTask>,      // 有 todoist_id 的任务
     *   tasksWithoutId: VaultTaskWithoutId[]      // 无 todoist_id 的任务（新任务未同步）
     * }
     */
    async scanVaultTasks(): Promise<{
        tasksWithId: Map<string, VaultTask>;
        tasksWithoutId: VaultTaskWithoutId[];
    }> {
        const tasksWithId = new Map<string, VaultTask>();
        const tasksWithoutId: VaultTaskWithoutId[] = [];
        
        const storageDir = this.plugin.settings?.storageDirectory || 'ultimate-todoist-sync';
        const files = this.app.vault.getFiles().filter(f => f.extension === 'md' && !f.path.startsWith(storageDir + '/') && !f.path.startsWith('.'));

        for (const file of files) {
            try {
                const content = await this.app.vault.cachedRead(file);
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    
                    if (!line.includes('#todoist')) {
                        continue;
                    }
                    
                    const match = line.match(/%%\[todoist_id::\s*([\w-]+)\]%%/);
                    const taskContent = this.plugin.taskParser.getTaskContentFromLineText(line);
                    const isCompleted = /\[x\]/i.test(line);
                    const labels = this.extractLabelsFromLine(line);
                    
                    if (match && match[1]) {
                        const taskId = match[1];
                        
                        if (tasksWithId.has(taskId)) {
                            continue;
                        }

                        tasksWithId.set(taskId, {
                            taskId,
                            content: taskContent,
                            isCompleted,
                            filePath: file.path,
                            lineNumber: i,
                            labels
                        });
                    } else {
                        tasksWithoutId.push({
                            content: taskContent,
                            isCompleted,
                            filePath: file.path,
                            lineNumber: i,
                            labels
                        });
                    }
                }
            } catch (error) {
                console.error(`Error reading file ${file.path}:`, error);
            }
        }

        return { tasksWithId, tasksWithoutId };
    }

    /**
     * 从 syncData 中获取 Todoist 任务
     * 
     * @param syncData - Todoist Sync API 返回的数据
     * @returns Map<taskId, TodoistTask>
     */
    getTodoistTasksFromSyncData(syncData: Record<string, any> | null): Map<string, TodoistTask> {
        const todoistTasksMap = new Map<string, TodoistTask>();
        
        if (!syncData || !syncData.items) {
            return todoistTasksMap;
        }
        
        for (const task of syncData.items) {
            if (!task) continue;
            const taskAny = task as any;
            
            todoistTasksMap.set(task.id, {
                taskId: task.id,
                content: task.content || '',
                checked: !!taskAny.checked,
                dueDate: task.due?.date,
                priority: task.priority || 1,
                projectId: taskAny.project_id || '',
                labels: task.labels || []
            });
        }

        return todoistTasksMap;
    }

    /**
     * 从行文本中提取标签
     * 
     * @param line - 行文本
     * @returns 标签数组（不带 # 前缀）
     */
    private extractLabelsFromLine(line: string): string[] {
        return this.plugin.taskParser.getAllTagsFromLineText(line)
            .filter(l => l !== 'todoist');
    }


}
