import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";
import { LogAction } from './logOperation';

interface MyProject {
	id: string;
	name: string;
  }


export interface UltimateTodoistSyncSettings {
    initialized:boolean;
	//mySetting: string;
	//todoistTasksFilePath: string;
	todoistAPIToken: string; // replace with correct type
	apiInitialized:boolean;
	defaultProjectName: string;
	defaultProjectId:string;
	automaticSynchronizationInterval:Number;
	todoistTasksData:any;
	fileMetadata:any;
	enableFullVaultSync: boolean;
	statistics: any;
	debugMode:boolean;
	useAppURI:boolean;
	// Log settings
	enableLog:boolean;
	logs:Array<{
		timestamp:number;
		action:LogAction;
		details:string;
		filePath?:string;
		taskId?:string;
	}>;
}


export const DEFAULT_SETTINGS: UltimateTodoistSyncSettings = {
	initialized: false,
	apiInitialized:false,
	todoistAPIToken: '',
	defaultProjectName:"Inbox",
	defaultProjectId:"",
	automaticSynchronizationInterval: 300, //default aync interval 300s
	todoistTasksData:{"projects":[],"tasks":[],"events":[]},
	fileMetadata:{},
	enableFullVaultSync:false,
	statistics:{},
	debugMode:false,
	useAppURI:true,
	enableLog:true,
	logs:[],
}





export class UltimateTodoistSyncSettingTab extends PluginSettingTab {
	plugin: UltimateTodoistSyncForObsidian;

	constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for Ultimate Todoist Sync for Obsidian.' });

		const myProjectsOptions: MyProject | undefined = this.plugin.settings.todoistTasksData?.projects?.reduce((obj, item) => {
			obj[(item.id).toString()] = item.name;
			return obj;
		  }, {});	  

		new Setting(containerEl)
			.setName('Todoist API')
			.setDesc('Please enter todoist api token and click the paper airplane button to submit.')
			.addText((text) =>
				text
					.setPlaceholder('Enter your API')
					.setValue(this.plugin.settings.todoistAPIToken)
					.onChange(async (value) => {
						this.plugin.settings.todoistAPIToken = value;
						this.plugin.settings.apiInitialized = false;
						//
					})
	
			)
			.addExtraButton((button) => {
				button.setIcon('send')
					.onClick(async () => {
							await this.plugin.modifyTodoistAPI(this.plugin.settings.todoistAPIToken)
							this.display()
							
						})
					
					
			})

			


		new Setting(containerEl)
		.setName('Automatic Sync Interval Time')
		.setDesc('Please specify the desired interval time, with seconds as the default unit. The default setting is 300 seconds, which corresponds to syncing once every 5 minutes. You can customize it, but it cannot be lower than 20 seconds.')
		.addText((text) =>
			text
				.setPlaceholder('Sync interval')
				.setValue(this.plugin.settings.automaticSynchronizationInterval.toString())
				.onChange(async (value) => {
					const intervalNum = Number(value)
					if(isNaN(intervalNum)){
						new Notice(`Wrong type,please enter a number.`)
						return
					}
					if(intervalNum < 20 ){
						new Notice(`The synchronization interval time cannot be less than 20 seconds.`)
						return
					}
					if (!Number.isInteger(intervalNum)) {
						new Notice('The synchronization interval must be an integer.');
						return;
					}
					this.plugin.settings.automaticSynchronizationInterval = intervalNum;
					this.plugin.saveSettings()
					new Notice('Settings have been updated.');
					//
				})

		)


		/*
		new Setting(containerEl)
			.setName('The default project for new tasks')
			.setDesc('New tasks are automatically synced to the Inbox. You can modify the project here.')
			.addText((text) =>
				text
					.setPlaceholder('Enter default project name:')
					.setValue(this.plugin.settings.defaultProjectName)
					.onChange(async (value) => {
						try{
							//this.plugin.cacheOperation.saveProjectsToCache()
							const newProjectId = this.plugin.cacheOperation.getProjectIdByNameFromCache(value)
							if(!newProjectId){
								new Notice(`This project seems to not exist.`)
								return
							}
						}catch(error){
							new Notice(`Invalid project name `)
							return
						}
						this.plugin.settings.defaultProjectName = value;
						this.plugin.saveSettings()
						new Notice(`The default project has been modified successfully.`)

					})

		);
		*/

		new Setting(containerEl)
			.setName('Default Project')
			.setDesc('New tasks are automatically synced to the default project. You can modify the project here.')
			.addDropdown(component => 
				component
						.addOption(this.plugin.settings.defaultProjectId,this.plugin.settings.defaultProjectName)
						.addOptions(myProjectsOptions)
						.onChange((value)=>{
							this.plugin.settings.defaultProjectId = value
							this.plugin.settings.defaultProjectName = this.plugin.cacheOperation.getProjectNameByIdFromCache(value)
							this.plugin.saveSettings()
							
							
						})
						
				)


		
		new Setting(containerEl)
			.setName('Full Vault Sync')
			.setDesc('By default, only tasks marked with #todoist are synchronized. If this option is turned on, all tasks in the vault will be synchronized.')
			.addToggle(component => 
				component
						.setValue(this.plugin.settings.enableFullVaultSync)
						.onChange((value)=>{
							this.plugin.settings.enableFullVaultSync = value
							this.plugin.saveSettings()
							new Notice("Full vault sync is enabled.")							
						})
						
				)						



		new Setting(containerEl)
		.setName('Manual Sync')
		.setDesc('Manually perform a synchronization task.')
		.addButton(button => button
			.setButtonText('Sync')
			.onClick(async () => {
				// Add code here to handle exporting Todoist data
				if(!this.plugin.settings.apiInitialized){
					new Notice(`Please set the todoist api first`)
					return
				}
				try{
					await this.plugin.scheduledSynchronization()
					this.plugin.syncLock = false
					new Notice(`Sync completed..`)
				}catch(error){
					new Notice(`An error occurred while syncing.:${error}`)
					this.plugin.syncLock = false
				}

			})
		);

		new Setting(containerEl)
		.setName('Rebuild Cache')
		.setDesc('Scan the vault and Todoist to rebuild the task cache. Use this if your cache is corrupted or lost.')
		.addButton(button => button
			.setButtonText('Rebuild')
			.onClick(async () => {
				if(!this.plugin.settings.apiInitialized){
					new Notice(`Please set the todoist api first`)
					return
				}
				
				const rebuildNotice = new Notice('Starting cache rebuild...', 0);
				
				try{
					const result = await this.plugin.cacheOperation.rebuildCache((message: string) => {
						rebuildNotice.setMessage(message);
					});
					
					if(result.success){
						new Notice(`Cache rebuilt successfully! ${result.tasksProcessed} tasks processed.`);
					}else{
						new Notice(`Cache rebuild failed!`);
					}
				}catch(error){
					new Notice(`Cache rebuild failed: ${error.message}`);
				}
			})
		);				



		new Setting(containerEl)
		.setName('Check Database')
		.setDesc('Check for possible issues: sync errors, file renaming, missing tasks, or conflicts between Obsidian and Todoist.')
		.addButton(button => button
			.setButtonText('Check Database')
			.onClick(async () => {
				if(!this.plugin.settings.apiInitialized){
					new Notice(`Please set the todoist api first`)
					return
				}

				const checkNotice = new Notice('Checking database integrity...', 0);

				try{
					const result = await this.plugin.databaseChecker!.checkDatabase((message: string) => {
						checkNotice.setMessage(message);
					});

					checkNotice.hide();

					if(result.success){
						new Notice(`Database check passed! No issues found.\nReport saved to: .todoist-reports/`);
					}else{
						let message = `Found ${result.totalIssues} issues:\n`;
						message += `- ${result.summary.taskDeletedInTodoist} deleted in Todoist\n`;
						message += `- ${result.summary.missingInCache} missing in cache\n`;
						message += `- ${result.summary.newTaskNotSynced} not synced\n`;
						message += `- ${result.summary.fileReferenceMissing} file reference missing\n`;
						message += `- ${result.summary.orphanedInCache} orphaned in cache\n`;
						message += `- ${result.summary.taskNotInVault} not in vault\n`;
						message += `- ${result.summary.contentMismatch} content mismatch\n`;
						message += `- ${result.summary.cacheContentOutdated} cache content outdated\n`;
						message += `- ${result.summary.statusMismatch} status mismatch\n`;
						message += `- ${result.summary.cacheStatusOutdated} cache status outdated\n`;
						message += `- ${result.summary.duedateMismatch} due date mismatch\n`;
						message += `- ${result.summary.duplicateTask} duplicate tasks\n`;
						message += `- ${result.summary.priorityMismatch} priority mismatch\n`;
						message += `- ${result.summary.projectMismatch} project mismatch\n\n`;

						if (result.reportPath) {
							message += `Report saved to: ${result.reportPath}`;
						}

						new Notice(message, 10000);

						this.plugin.logOperation?.log('DATABASE_CHECK', `Found ${result.totalIssues} database issues`);
					}

					if (result.reportPath) {
						new Notice(`Detailed report saved to: ${result.reportPath}`, 5000);
					}else{
						new Notice(`Report generation failed. Check console for details.`, 5000);
					}
				}catch(error){
					checkNotice.hide();
					new Notice(`Database check failed: ${error.message}`);
				}
			})
		);

		new Setting(containerEl)
			.setName('Debug Mode')
			.setDesc('After enabling this option, all log information will be output to the console, which can help check for errors.')
			.addToggle(component => 
				component
						.setValue(this.plugin.settings.debugMode)
						.onChange((value)=>{
							this.plugin.settings.debugMode = value
							this.plugin.saveSettings()						
						})
						
				)

		new Setting(containerEl)
			.setName('Enable Log')
			.setDesc('Enable logging of file modifications.')
			.addToggle(component => 
				component
						.setValue(this.plugin.settings.enableLog)
						.onChange((value)=>{
							this.plugin.settings.enableLog = value
							this.plugin.saveSettings()						
						})
						
				)

		new Setting(containerEl)
			.setName('View Logs')
			.setDesc('View the operation logs.')
			.addButton(button => button
				.setButtonText('View Logs')
				.onClick(() => {
					const logsText = this.plugin.logOperation?.getLogsAsText() || 'No logs available.';
					const logModal = new Notice(logsText, 10000);
				})
			);

		new Setting(containerEl)
			.setName('Clear Logs')
			.setDesc('Clear all operation logs.')
			.addButton(button => button
				.setButtonText('Clear')
				.onClick(() => {
					this.plugin.logOperation?.clearLogs();
					new Notice('Logs cleared.');
				})
			);

		new Setting(containerEl)
			.setName('Backup Todoist Data')
			.setDesc('Click to backup Todoist data, The backed-up files will be stored in the root directory of the Obsidian vault.')
			.addButton(button => button
				.setButtonText('Backup')
				.onClick(() => {
					// Add code here to handle exporting Todoist data
					if(!this.plugin.settings.apiInitialized){
						new Notice(`Please set the todoist api first`)
						return
					}
					this.plugin.todoistSync.backupTodoistAllResources()
				})
			);

		new Setting(containerEl)
			.setName('Use Desktop URIs')
			.setDesc('If enabled produces application URI links (todoist://...) instead of web urls (https://...), which open in the app instead of the browser')
			.addToggle(component => 
				component
						.setValue(this.plugin.settings.useAppURI)
						.onChange((value)=>{
							this.plugin.settings.useAppURI = value
							this.plugin.saveSettings()						
						})
						
				)
	}
}

