import { App, Modal ,Setting } from "obsidian";
import  UltimateTodoistSyncForObsidian  from "../main"


interface MyProject {
	id: string;
	name: string;
  }

export class SetDefalutProjectInTheFilepathModal extends Modal {
  defaultProjectId: string
  defaultProjectName: string
  filepath:string
  plugin:UltimateTodoistSyncForObsidian

    
  constructor(app: App,plugin:UltimateTodoistSyncForObsidian, filepath:string) {
    super(app);
    this.filepath = filepath
    this.plugin = plugin
    this.open()
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h5', { text: 'Set default project for todoist tasks in the current file' });

    this.defaultProjectId = await this.plugin.cacheOperation.getDefaultProjectIdForFilepath(this.filepath)
    const project = await this.plugin.todoistSyncAPI.getProjectById(this.defaultProjectId)
    this.defaultProjectName = project?.name ?? this.plugin.settings.defaultProjectName
    console.log(this.defaultProjectId)
    console.log(this.defaultProjectName)
    const projects = this.plugin.todoistSyncAPI.getSyncData()?.projects || []
    const myProjectsOptions: MyProject | undefined = projects.reduce((obj, item) => {
        obj[(item.id).toString()] = item.name;
        return obj;
        }, {}
    );
      
    

    new Setting(contentEl)
    .setName('Default project')
    //.setDesc('Set default project for todoist tasks in the current file')
    .addDropdown(component => 
        component
                .addOption(this.defaultProjectId,this.defaultProjectName)
                .addOptions(myProjectsOptions)
                .onChange((value)=>{
                    console.log(`project id  is ${value}`)
                    this.plugin.cacheOperation.setDefaultProjectIdForFilepath(this.filepath,value)
                    this.plugin.setStatusBarText()
                    this.close();
                    
                })
                
        )


  

  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}