import { MarkdownView, Notice, Plugin, Editor } from 'obsidian';

import { UltimateTodoistSyncSettings, DEFAULT_SETTINGS, UltimateTodoistSyncSettingTab } from './src/settings/settings';
import { TodoistRestAPI } from './src/api/restApi';
import { TodoistSyncAPI } from './src/api/syncApi';
import { TaskParser } from './src/data/taskParser';
import { CacheOperation } from './src/data/cache';
import { FileOperation } from './src/vault/fileOperation';
import { LogOperation } from './src/storage/log';
import { BackupOperation } from './src/storage/backup';
import { ObsidianToTodoistSync } from './src/sync/toTodoist';
import { TodoistToObsidianSync } from './src/sync/toObsidian';
import { DatabaseChecker } from './src/data/databaseChecker';
import { DeviceManager } from './src/utils/deviceManager';
import { StoragePathManager } from './src/storage/pathManager';
import { SafeSettings, SettingsBackup } from './src/settings/safeSettings';
import { SetDefalutProjectInTheFilepathModal } from './src/ui/modals';

export default class UltimateTodoistSyncForObsidian extends Plugin {
	settings: UltimateTodoistSyncSettings;
    todoistRestAPI: TodoistRestAPI | undefined;
    todoistSyncAPI: TodoistSyncAPI | undefined;
    taskParser: TaskParser | undefined;
    cacheOperation: CacheOperation | undefined;
    fileOperation: FileOperation | undefined;
    obsidianToTodoist: ObsidianToTodoistSync | undefined;
    todoistToObsidian: TodoistToObsidianSync | undefined;
    logOperation: LogOperation | undefined;
    backupOperation: BackupOperation | undefined;
	databaseChecker: DatabaseChecker | undefined;
    deviceManager: DeviceManager | undefined;
    storagePathManager: StoragePathManager | undefined;
  	settingsBackup: SettingsBackup | undefined;
    safeSettings: SafeSettings | undefined;
  	lastLines: Map<string,number>;
 	statusBar;
 	syncLock: boolean;
 	saveLock: boolean;
 	isProcessingModify: boolean;
 	scheduledSyncInProgress: boolean;

	async onload() {
		this.saveLock = false;
		this.scheduledSyncInProgress = false;

		const isSettingsLoaded = await this.loadSettings();

		if(!isSettingsLoaded){
			new Notice('Settings failed to load. Please reload the ultimate todoist sync plugin.');
			return;
		}

		this.settingsBackup = new SettingsBackup(this.app, this);
		this.safeSettings = new SafeSettings(this);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new UltimateTodoistSyncSettingTab(this.app, this));
		if (!this.settings.todoistAPIToken) {
			new Notice('Please enter your Todoist API.');
			//return	   
		}else{
			await this.initializePlugin();
		}

		//lastLine 对象 {path:line}保存在lastLines map中
		this.lastLines = new Map();








		//key 事件监听，判断换行和删除
		this.registerDomEvent(document, 'keyup', async (evt: KeyboardEvent) =>{
			if(!this.settings.apiInitialized){
				return
			}
			//console.log(`key pressed`)
			
			//判断点击事件发生的区域,如果不在编辑器中，return
			if (!(this.app.workspace.activeEditor?.editor?.hasFocus())) {
				(console.log(`editor is not focused`))
				return
			}
	
			if (evt.key === 'ArrowUp' || evt.key === 'ArrowDown' || evt.key === 'ArrowLeft' || evt.key === 'ArrowRight' ||evt.key === 'PageUp' || evt.key === 'PageDown') {
				//console.log(`${evt.key} arrow key is released`);
				if(!( this.checkModuleClass())){
					return
				}
				this.lineNumberCheck()
			}
			if(evt.key === "Delete" || evt.key === "Backspace"){
				try{
					//console.log(`${evt.key} key is released`);
					if(!( this.checkModuleClass())){
						return
					}
					if (!await this.checkAndHandleSyncLock('obsidianToTodoist')) return;
					const deletedCount = await this.obsidianToTodoist.deletedTaskCheck();
					this.syncLock = false;
					if (deletedCount > 0) {
						this.saveSettings();
					}
				}catch(error){
					console.error(`An error occurred while deleting tasks: ${error}`);
					this.syncLock = false
				}
	
			}
		});

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', async (evt: MouseEvent) => {
			if(!this.settings.apiInitialized){
				return
			}
			//console.log('click', evt);
			if (this.app.workspace.activeEditor?.editor?.hasFocus()) {
				//console.log('Click event: editor is focused');
				this.lineNumberCheck()
			}
			else{
				//
			}

			const target = evt.target as HTMLInputElement;

			if (target.type === "checkbox") {
				if(!(this.checkModuleClass())){
					return
				}
				this.checkboxEventhandle(evt)
				//this.obsidianToTodoist.fullTextModifiedTaskCheck()

			}

		});



		//hook editor-change 事件，如果当前line包含 #todoist,说明有new task
		this.registerEvent(this.app.workspace.on('editor-change',async (editor,view:MarkdownView)=>{
			try{
				if(!this.settings.apiInitialized){
					return
				}
	
				this.lineNumberCheck()
				if(!(this.checkModuleClass())){
					return
				}
				if (!await this.checkAndHandleSyncLock('obsidianToTodoist')) return;
				await this.obsidianToTodoist.lineContentNewTaskCheck(editor,view)
				this.syncLock = false

			}catch(error){
				console.error(`An error occurred while check new task in line: ${error.message}`);
				this.syncLock = false
			}

		}))



 		//监听 rename 事件,更新 task data 中的 path
		this.registerEvent(this.app.vault.on('rename', async (file,oldpath) => {
			if(!this.settings.apiInitialized){
				return
			}
			console.log(`${oldpath} is renamed`)
			const taskCount = this.cacheOperation.getTaskCountInFile(oldpath)
			if(taskCount === 0){
				console.log('The renamed file has no tasks.')
				return
			}
			if(!(this.checkModuleClass())){
					return
				}
			await this.cacheOperation.updateRenamedFilePath(oldpath,file.path)
			this.saveSettings()
			this.logOperation?.log('FILE_RENAMED', `File renamed from ${oldpath} to ${file.path}`, file.path);
			
			//update task description
			if (!await this.checkAndHandleSyncLock('obsidianToTodoist')) return;
			try {
				await this.obsidianToTodoist.updateTaskDescription(file.path)
			} catch(error) {
				console.error('An error occurred in updateTaskDescription:', error);
			}
			this.syncLock = false;

		}));


		//Listen for file modified events and execute fullTextNewTaskCheck
		this.registerEvent(this.app.vault.on('modify', async (file) => {
			try {
				if(!this.settings.apiInitialized){
					return
				}
				
				// Re-entry protection - prevent infinite loop
				if (this.isProcessingModify) {
					return
				}
				this.isProcessingModify = true;
				
				const filepath = file.path
				
				// Skip files in storage directory (logs, backups, reports)
				const storagePath = this.storagePathManager?.getBasePath() || 'ultimate-todoist-sync';
				if (filepath.includes(storagePath)) {
					this.isProcessingModify = false;
					return;
				}

				console.log(`${filepath} is modified`)

				//get current view
				
				const activateFile = this.app.workspace.getActiveFile()

				console.log(activateFile?.path)

				//To avoid conflicts, Do not check files being edited
				if(activateFile?.path == filepath){
					this.isProcessingModify = false;
					return
				}

				if (!await this.checkAndHandleSyncLock('obsidianToTodoist')) {
					this.isProcessingModify = false;
					return;
				}
				
				await this.obsidianToTodoist.fullTextNewTaskCheck(filepath)
				this.syncLock = false;
			} catch(error) {
				console.error(`An error occurred while modifying the file: ${error.message}`);
				this.syncLock = false
				// You can add further error handling logic here. For example, you may want to 
				// revert certain operations, or alert the user about the error.
			} finally {
				this.isProcessingModify = false;
			}
		}));

		this.registerInterval(window.setInterval(async () => await this.scheduledSynchronization(), this.settings.automaticSynchronizationInterval * 1000));

		this.app.workspace.on('active-leaf-change',(leaf)=>{
			this.setStatusBarText()
		})


		// set default  project for todoist task in the current file
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'set-default-project-for-todoist-task-in-the-current-file',
			name: 'Set default project for todoist task in the current file',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if(!view){
					return
				}
				const filepath = view.file.path
				new SetDefalutProjectInTheFilepathModal(this.app,this,filepath)
				
			}
		});

		//display default project for the current file on status bar
		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		this.statusBar = this.addStatusBarItem();


	}


	async onunload() {
		console.log(`Ultimate Todoist Sync for Obsidian id unloaded!`)
		
		// Flush log buffer before unloading
		try {
			await this.logOperation?.flushToFile();
		} catch (error) {
			console.error('An error occurred in flushToFile:', error);
		}
		
		await this.saveSettings()

	}

	async loadSettings(): Promise<boolean> {
		this.settingsBackup = new SettingsBackup(this.app, this);

		try {
			if (await this.settingsBackup.hasTempFile()) {
				console.warn('[Settings] Found temp file, attempting recovery...');
				new Notice('Found unsaved changes, attempting recovery...');
				
				const recovered = await this.settingsBackup.recoverFromTempFile();
				if (recovered) {
					new Notice('Settings recovered from unsaved changes');
				} else {
					new Notice('Failed to recover from unsaved changes, using backup');
					await this.settingsBackup.restore();
				}
			}

			const data = await this.loadData();

			if (!this.validateLoadedSettings(data)) {
				console.warn('[Settings] Settings corrupted, attempting recovery...');
				new Notice('Settings corrupted, attempting recovery...');
				
				const recovered = await this.settingsBackup.restore();
				if (recovered) {
					new Notice('Settings recovered from backup');
					const recoveredData = await this.loadData();
					this.settings = Object.assign({}, DEFAULT_SETTINGS, recoveredData);
					this.stripGhostFields();
					this.sanitizeTaskFileMapping();
					return true;
				}

				console.error('[Settings] Recovery failed, using default settings');
				this.settings = Object.assign({}, DEFAULT_SETTINGS);
				new Notice('Settings reset to defaults due to corruption');
				await this.saveSettings();
				return true;
			}

			this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
			this.stripGhostFields();
			this.sanitizeTaskFileMapping();
			return true;
		} catch (error) {
			console.error('[Settings] Failed to load data:', error);
			this.settings = Object.assign({}, DEFAULT_SETTINGS);
			return true;
		}
	}

	private stripGhostFields(): void {
		const GHOST_FIELDS = ['todayLogs', 'todoistTasksData', 'syncToken', 'logs', 'logRetentionDays', 'statistics', 'deviceIdGenerated'];
		const settings = this.settings as unknown as Record<string, unknown>;
		let stripped = 0;
		for (const field of GHOST_FIELDS) {
			if (field in settings) {
				delete settings[field];
				stripped++;
			}
		}
		if (stripped > 0) {
			console.log(`[Settings] Stripped ${stripped} ghost field(s) from loaded data`);
		}
	}

	private sanitizeTaskFileMapping(): void {
		const mapping = this.settings.taskFileMapping;
		if (!mapping) return;
		let fixed = 0;
		for (const [taskId, entry] of Object.entries(mapping)) {
			if (typeof entry.lineNumber !== 'number') {
				console.warn(`[Settings] taskFileMapping[${taskId}].lineNumber is "${entry.lineNumber}" (${typeof entry.lineNumber}), resetting to 0`);
				entry.lineNumber = 0;
				entry.status = 'issue';
				entry.syncEnabled = false;
				fixed++;
			}
		}
		if (fixed > 0) {
			console.log(`[Settings] Sanitized ${fixed} corrupted taskFileMapping entry(s)`);
		}
	}

	private validateLoadedSettings(data: any): boolean {
		if (!data || typeof data !== 'object') {
			console.warn('[Settings] Settings data is not a valid object');
			return false;
		}

		const requiredFields = ['initialized', 'todoistAPIToken', 'taskFileMapping'];
		for (const field of requiredFields) {
			if (!(field in data)) {
				console.warn(`[Settings] Missing required field: ${field}`);
				return false;
			}
		}

		if (data.taskFileMapping && typeof data.taskFileMapping !== 'object') {
			console.warn('[Settings] taskFileMapping is not a valid object');
			return false;
		}

		try {
			JSON.parse(JSON.stringify(data));
			return true;
		} catch {
			console.warn('[Settings] Settings data cannot be stringified');
			return false;
		}
	}

	async saveSettings(): Promise<boolean> {
		if (this.saveLock) {
			console.log('[Settings] Save already in progress, skipping...');
			return false;
		}

		this.saveLock = true;
		const settingsPath = StoragePathManager.SETTINGS_FILE;
		const tempPath = StoragePathManager.SETTINGS_TEMP_FILE;

		try {
			if (!this.settings || Object.keys(this.settings).length === 0) {
				console.error('[Settings] Settings are empty or invalid, not saving to avoid data loss.');
				this.saveLock = false;
				return false;
			}

			if (!this.validateSettings()) {
				console.error('[Settings] Settings validation failed');
				this.saveLock = false;
				return false;
			}

			const settingsJson = JSON.stringify(this.settings, null, 2);
			const adapter = this.app.vault.adapter;

			await adapter.write(tempPath, settingsJson);
			console.log('[Settings] Written to temp file:', tempPath);

			const tempExists = await adapter.exists(tempPath);
			if (!tempExists) {
				throw new Error('Temp file was not created');
			}

			await adapter.write(settingsPath, settingsJson);
			console.log('[Settings] Written to actual file:', settingsPath);

			try {
				await adapter.remove(tempPath);
				console.log('[Settings] Temp file cleaned up');
			} catch (cleanupError) {
				console.warn('[Settings] Failed to cleanup temp file:', cleanupError);
			}

			console.log('[Settings] Settings saved successfully');
			this.saveLock = false;
			return true;
		} catch (error) {
			console.error('[Settings] Error saving settings:', error);
			console.error('[Settings] Temp file preserved for recovery at:', tempPath);
			new Notice('Settings save failed, temp file preserved for recovery');
			this.saveLock = false;
			return false;
		}
	}

	private validateSettings(): boolean {
		if (!this.settings) {
			return false;
		}

		const requiredFields = ['initialized', 'todoistAPIToken', 'taskFileMapping'];
		for (const field of requiredFields) {
			if (!(field in this.settings)) {
				console.error(`[SettingsValidator] Missing required field: ${field}`);
				return false;
			}
		}

		if (this.settings.taskFileMapping && typeof this.settings.taskFileMapping !== 'object') {
			return false;
		}

		try {
			JSON.parse(JSON.stringify(this.settings));
			return true;
		} catch {
			return false;
		}
	}

	async modifyTodoistAPI(api:string){
		await this.initializePlugin() 
	}

	// return true of false
	async initializePlugin(){
		
		//initialize todoist restapi 
		this.todoistRestAPI = new TodoistRestAPI(this.app, this)

		//initialize log operation
		this.logOperation = new LogOperation(this.app, this)

		//initialize data read and write object
		this.cacheOperation = new CacheOperation(this.app, this)
		const isProjectsSaved = await this.cacheOperation.saveProjectsToCache()



		if(!isProjectsSaved){
			this.todoistRestAPI = undefined
			this.todoistSyncAPI = undefined
			this.taskParser = undefined
			this.taskParser = undefined
			this.cacheOperation = undefined
			this.fileOperation = undefined
			this.obsidianToTodoist = undefined
			this.todoistToObsidian = undefined
			this.logOperation = undefined
			this.backupOperation = undefined
			await this.safeSettings?.update({ initialized: false, apiInitialized: false }, true)
			new Notice(`Ultimate Todoist Sync plugin initialization failed, please check the todoist api`)
			return;		
		}

		if(!this.settings.initialized){

			//创建备份文件夹备份todoist 数据
			try{
				//每次启动前备份所有数据
				// Note: Initialize module class first to enable backupOperation
				this.initializeModuleClass();
				this.todoistToObsidian.backupTodoistAllResources()

			}catch(error){
				console.log(`error creating user data folder: ${error}`)
				await this.safeSettings?.update({ initialized: false, apiInitialized: false }, true)
				new Notice(`error creating user data folder`)
				return;
			}


			//初始化settings
			await this.safeSettings?.update({ initialized: true }, true)
			new Notice(`Ultimate Todoist Sync initialization successful. Todoist data has been backed up.`)

		} else {
			// Already initialized, just initialize the module class
			this.initializeModuleClass();
		}

		
		//get user plan resources
		//const rsp = await this.todoistSyncAPI.getUserResource()
		await this.safeSettings?.update({ apiInitialized: true })
		this.syncLock = false
		new Notice(`Ultimate Todoist Sync loaded successfully.`)
		this.logOperation?.log('PLUGIN_INITIALIZED', 'Plugin initialized successfully');

		// Run database check on startup (non-blocking)
		this.runStartupDatabaseCheck();
		
		return true
		


	}

	async runStartupDatabaseCheck(): Promise<void> {
		try {
			if (!this.databaseChecker) {
				console.log('Database checker not initialized, skipping startup check');
				return;
			}

			console.log('Running startup database check...');
			const result = await this.databaseChecker.checkDatabase();

			await this.safeSettings?.update({
				lastDatabaseCheckPassed: result.success,
				lastDatabaseCheckTime: Date.now()
			}, true);

			if (result.success) {
				console.log('Startup database check passed');
			} else {
				await this.safeSettings?.update({ syncEnabled: false }, true);
				new Notice(`Found ${result.totalIssues} database issues. Sync has been disabled until issues are fixed.`);
			}
		} catch (error) {
			console.error('Startup database check failed:', error);
		}
	}

	async initializeModuleClass(){

		//initialize todoist restapi 
		this.todoistRestAPI = new TodoistRestAPI(this.app,this)

		//initialize data read and write object
		this.cacheOperation = new CacheOperation(this.app,this)
		this.taskParser = new TaskParser(this.app,this)

		//initialize file operation
		this.fileOperation = new FileOperation(this.app,this)

		//initialize todoisy sync api
		this.todoistSyncAPI = new TodoistSyncAPI(this.app,this)

		this.obsidianToTodoist = new ObsidianToTodoistSync(this.app, this)
		this.todoistToObsidian = new TodoistToObsidianSync(this.app, this)

		//initialize backup operation
		this.backupOperation = new BackupOperation(this.app,this)

		//initialize database checker
		this.databaseChecker = new DatabaseChecker(this.app, this)

		//initialize device manager
		this.deviceManager = new DeviceManager(this.app, this)

		//initialize storage path manager
		this.storagePathManager = new StoragePathManager(this.app, this)
		
		//ensure all storage directories exist
		this.storagePathManager.ensureAllDirs().catch(error => {
			console.error('[Plugin] Failed to create storage directories:', error);
		});

		// load historical logs now that storagePathManager is ready
		this.logOperation?.loadFromFile().catch(error => {
			console.error('[Plugin] Failed to load logs from file:', error);
		});

		//initialize sync data (load from cache or full sync on startup)
		try {
			const loaded = this.todoistSyncAPI?.loadFromCache();
			if (!loaded) {
				await this.todoistSyncAPI?.initializeSync();
			} else {
				this.todoistSyncAPI?.incrementalSync().catch(err => {
					console.error('[Plugin] Incremental sync after cache load failed:', err);
				});
			}
		} catch (error) {
			console.error('[Plugin] Failed to initialize sync:', error);
		}

	}

	async lineNumberCheck(){
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		if(view){
			const cursor = view.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getCursor()
			const line = cursor?.line
			//const lineText = view.editor.getLine(line)
			const fileContent = view.data

			//console.log(line)
			//const fileName = view.file?.name
			const fileName =  view.app.workspace.getActiveViewOfType(MarkdownView)?.app.workspace.activeEditor?.file?.name
			const filepath =  view.app.workspace.getActiveViewOfType(MarkdownView)?.app.workspace.activeEditor?.file?.path
			if (typeof this.lastLines === 'undefined' || typeof this.lastLines.get(fileName as string) === 'undefined'){
				this.lastLines.set(fileName as string, line as number);
				return
			}

					//console.log(`filename is ${fileName}`)
			if(this.lastLines.has(fileName as string) && line !== this.lastLines.get(fileName as string)){
				const lastLine = this.lastLines.get(fileName as string)
				if(this.settings.debugMode){
					console.log('Line changed!', `current line is ${line}`, `last line is ${lastLine}`);
				}


				// 执行你想要的操作
				const lastLineText = view.editor.getLine(lastLine as number)
				//console.log(lastLineText)
				if(!( this.checkModuleClass())){
					return
				}
				this.lastLines.set(fileName as string, line as number);
				try{
					if (!await this.checkAndHandleSyncLock('obsidianToTodoist')) return;
					await this.obsidianToTodoist.lineModifiedTaskCheck(filepath as string,lastLineText,lastLine as number,fileContent)
					this.syncLock = false;
				}catch(error){
					console.error(`An error occurred while check modified task in line text: ${error}`);
					this.syncLock = false
				}


				
			}
			else  {
				//console.log('Line not changed');				
			}

		}


		

	}

	async checkboxEventhandle(evt:MouseEvent){
		if(!( this.checkModuleClass())){
			return
		}
		const target = evt.target as HTMLInputElement;

		const taskElement = target.closest("div");
		if (!taskElement) return;
		const regex = /\[todoist_id::\s*(\w+)\]/;
		const match = taskElement.textContent?.match(regex) || false;
		if (match) {
			const taskId = match[1];
			if (!this.cacheOperation?.isTaskSyncEnabled(taskId)) return;
			if (!await this.checkAndHandleSyncLock('obsidianToTodoist')) return;
			try {
				if (target.checked) {
					await this.obsidianToTodoist.closeTask(taskId);
				} else {
					await this.obsidianToTodoist.repoenTask(taskId);
				}
			} catch(error) {
				console.error(`An error occurred while toggling task: ${error}`);
			} finally {
				this.syncLock = false;
			}
		} else {
			if (!await this.checkAndHandleSyncLock('obsidianToTodoist')) return;
			try {
				await this.obsidianToTodoist.fullTextModifiedTaskCheck()
			} catch(error) {
				console.error(`An error occurred while check modified tasks in the file: ${error}`);
			} finally {
				this.syncLock = false;
			}
		}
	}

	//return true
	private lastApiNoticeTime = 0;

	checkModuleClass(){
		if(this.settings.apiInitialized  === true){
			if(this.todoistRestAPI === undefined || this.todoistSyncAPI === undefined ||this.cacheOperation === undefined || this.fileOperation === undefined ||this.obsidianToTodoist === undefined ||this.taskParser === undefined){
				this.initializeModuleClass()
			}
			return true
		}
		else{
			const now = Date.now();
			if (now - this.lastApiNoticeTime > 60_000) {
				new Notice(`Please enter the correct Todoist API token`)
				this.lastApiNoticeTime = now;
			}
			return(false)
		}
		

	}

	async setStatusBarText(){
		if(!( this.checkModuleClass())){
			return
		}
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		if(!view){
			this.statusBar.setText('');
		}
		else{
			const filepath = this.app.workspace.getActiveViewOfType(MarkdownView)?.file.path
			if(filepath === undefined){
				console.log(`file path undefined`)
				return
			}
			const defaultProjectName = await this.cacheOperation.getDefaultProjectNameForFilepath(filepath as string)
			if(defaultProjectName === undefined){
				console.log(`projectName undefined`)
				return
			}
			this.statusBar.setText(defaultProjectName)
		}

	}

	async scheduledSynchronization() {
		if (this.scheduledSyncInProgress) {
			console.log('Scheduled sync already in progress, skipping');
			return;
		}
		if (!(this.checkModuleClass())) {
			return;
		}

		this.scheduledSyncInProgress = true;
		console.log("Todoist scheduled synchronization task started at", new Date().toLocaleString());

		try {
			await this.withSyncLock('todoistToObsidian', async () => {
				await this.todoistToObsidian.syncTodoistToObsidian();
			});

			await this.saveSettings();
			await new Promise(resolve => setTimeout(resolve, 5000));

			const filesToSyncSet = new Set<string>();
			const taskFileMapping = this.settings.taskFileMapping;
			for (const taskId in taskFileMapping) {
				filesToSyncSet.add(taskFileMapping[taskId].filePath);
			}
			const filesToSync = Array.from(filesToSyncSet);

			if (this.settings.debugMode) {
				console.log('Files to sync:', filesToSync);
			}

			for (const fileKey of filesToSync) {
				if (this.settings.debugMode) {
					console.log('Syncing file:', fileKey);
				}

				const lockOk = await this.withSyncLock('obsidianToTodoist', async () => {
					await this.obsidianToTodoist.fullTextNewTaskCheck(fileKey);
				});
				if (!lockOk) continue;

				await this.withSyncLock('obsidianToTodoist', async () => {
					await this.obsidianToTodoist.deletedTaskCheck(fileKey);
				});

				await this.withSyncLock('obsidianToTodoist', async () => {
					await this.obsidianToTodoist.fullTextModifiedTaskCheck(fileKey);
				});
			}
		} catch (error) {
			console.error('An error occurred during scheduled sync:', error);
			this.syncLock = false;
		}

		try {
			await this.logOperation?.flushToFile();
		} catch (error) {
			console.error('An error occurred in flushToFile:', error);
		}

		this.scheduledSyncInProgress = false;
		console.log("Todoist scheduled synchronization task completed at", new Date().toLocaleString());
	}

	async withSyncLock(direction: 'obsidianToTodoist' | 'todoistToObsidian', fn: () => Promise<void>): Promise<boolean> {
		if (!await this.checkAndHandleSyncLock(direction)) return false;
		try {
			await fn();
		} catch(error) {
			console.error(`Error during ${direction} sync:`, error);
		} finally {
			this.syncLock = false;
		}
		return true;
	}

	async checkSyncLock() {
		let checkCount = 0;
		while (this.syncLock == true && checkCount < 10) {
		  await new Promise(resolve => setTimeout(resolve, 1000));
		  checkCount++;
		}
		if (this.syncLock == true) {
		  return false;
		}
		return true;
	}

	async checkAndHandleSyncLock(direction?: 'obsidianToTodoist' | 'todoistToObsidian'): Promise<boolean> {
		// Check 1: Database check status (先检查，更重要)
		if (!this.settings.lastDatabaseCheckPassed) {
			console.log('Sync is disabled due to database issues');
			new Notice('Sync is blocked due to database issues. Please fix the issues first.');
			return false;
		}

		// Check 2: User manual toggle (main switch)
		if (!this.settings.syncEnabled) {
			console.log('Sync is disabled by user (main switch off)');
			return false;
		}

		// Check 3: Direction-specific toggle
		if (direction === 'obsidianToTodoist' && !this.settings.obsidianToTodoistEnabled) {
			console.log('Obsidian → Todoist sync is disabled by user');
			return false;
		}
		
		if (direction === 'todoistToObsidian' && !this.settings.todoistToObsidianEnabled) {
			console.log('Todoist → Obsidian sync is disabled by user');
			return false;
		}

		if (this.syncLock) {
			console.log('sync locked.');
			const isSyncLockChecked = await this.checkSyncLock();
			if (!isSyncLockChecked) {
				return false;
			}
			console.log('sync unlocked.')
		}
		this.syncLock = true;
		return true;
	}

}




