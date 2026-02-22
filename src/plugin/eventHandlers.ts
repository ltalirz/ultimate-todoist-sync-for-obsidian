import { Editor, MarkdownView, TFile } from 'obsidian';

import UltimateTodoistSyncForObsidian from '../../main';

export class EventHandlers {
	private plugin: UltimateTodoistSyncForObsidian;

	constructor(plugin: UltimateTodoistSyncForObsidian) {
		this.plugin = plugin;
	}

	register(): void {
		this.plugin.registerDomEvent(document, 'keyup', (evt: KeyboardEvent) => this.onKeyUp(evt));
		this.plugin.registerDomEvent(document, 'click', (evt: MouseEvent) => this.onClick(evt));
		this.plugin.registerEvent(this.plugin.app.workspace.on('editor-change', (editor: Editor, view: MarkdownView) => this.onEditorChange(editor, view)));
		this.plugin.registerEvent(this.plugin.app.vault.on('rename', (file, oldpath) => this.onFileRename(file as TFile, oldpath)));
		this.plugin.registerEvent(this.plugin.app.vault.on('modify', (file) => this.onFileModify(file as TFile)));
	}

	private async onKeyUp(evt: KeyboardEvent): Promise<void> {
		if (!this.plugin.settings.apiInitialized) return;
		if (!(this.plugin.app.workspace.activeEditor?.editor?.hasFocus())) {
			this.plugin.debugLog(`editor is not focused`);
			return;
		}

		const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'];
		if (arrowKeys.includes(evt.key)) {
			if (!await this.plugin.checkModuleClass()) return;
			this.lineNumberCheck();
		}

		if (evt.key === 'Delete' || evt.key === 'Backspace') {
			try {
				if (!await this.plugin.checkModuleClass()) return;
				const filepath = this.plugin.app.workspace.getActiveFile()?.path;
				if (!filepath) return;
				if (!await this.plugin.syncLockManager.acquire('obsidianToTodoist')) return;
				const deletedCount = await this.plugin.obsidianToTodoist!.deletedTaskCheck(filepath);
				this.plugin.syncLockManager.release();
				if (deletedCount > 0) {
					this.plugin.saveSettings();
				}
			} catch (error) {
				console.error(`An error occurred while deleting tasks: ${error}`);
				this.plugin.syncLockManager.release();
			}
		}
	}

	private async onClick(evt: MouseEvent): Promise<void> {
		if (!this.plugin.settings.apiInitialized) return;

		if (this.plugin.app.workspace.activeEditor?.editor?.hasFocus()) {
			this.lineNumberCheck();
		}

		const target = evt.target as HTMLInputElement;
		if (target.type === 'checkbox') {
			if (!await this.plugin.checkModuleClass()) return;
			this.checkboxEventHandle(evt);
		}
	}

	private async onEditorChange(editor: Editor, view: MarkdownView): Promise<void> {
		try {
			if (!this.plugin.settings.apiInitialized) return;
			if (this.plugin.isSyncingFromTodoist) return;
			this.lineNumberCheck();
			if (!await this.plugin.checkModuleClass()) return;
			if (!await this.plugin.syncLockManager.acquire('obsidianToTodoist')) return;
			await this.plugin.obsidianToTodoist!.lineContentNewTaskCheck(editor, view);
			this.plugin.syncLockManager.release();
		} catch (error) {
			console.error(`An error occurred while check new task in line: ${(error as Error).message}`);
			this.plugin.syncLockManager.release();
		}
	}

	private async onFileRename(file: TFile, oldpath: string): Promise<void> {
		if (!this.plugin.settings.apiInitialized) return;
		this.plugin.debugLog(`${oldpath} is renamed`);

		const taskCount = this.plugin.cacheOperation!.getTaskCountInFile(oldpath);
		if (taskCount === 0) {
			this.plugin.debugLog('The renamed file has no tasks.');
			return;
		}
		if (!await this.plugin.checkModuleClass()) return;

		await this.plugin.cacheOperation!.updateRenamedFilePath(oldpath, file.path);
		this.plugin.saveSettings();
		this.plugin.logOperation?.log('FILE_RENAMED', `File renamed from ${oldpath} to ${file.path}`, file.path);

		if (!await this.plugin.syncLockManager.acquire('obsidianToTodoist')) return;
		try {
			await this.plugin.obsidianToTodoist!.updateTaskDescription(file.path);
		} catch (error) {
			console.error('An error occurred in updateTaskDescription:', error);
		}
		this.plugin.syncLockManager.release();
	}

	private async onFileModify(file: TFile): Promise<void> {
		try {
			if (!this.plugin.settings.apiInitialized) return;
			if (this.plugin.isSyncingFromTodoist) return;
			if (this.plugin.isProcessingModify) return;
			this.plugin.isProcessingModify = true;

			const filepath = file.path;
			const storagePath = this.plugin.storagePathManager?.getBasePath() || 'ultimate-todoist-sync';
			if (filepath.includes(storagePath)) {
				this.plugin.isProcessingModify = false;
				return;
			}

			this.plugin.debugLog(`${filepath} is modified`);
			const activeFile = this.plugin.app.workspace.getActiveFile();
			this.plugin.debugLog(activeFile?.path);

			if (activeFile?.path === filepath) {
				this.plugin.isProcessingModify = false;
				return;
			}

			if (!await this.plugin.syncLockManager.acquire('obsidianToTodoist')) {
				this.plugin.isProcessingModify = false;
				return;
			}

			await this.plugin.obsidianToTodoist!.fullTextNewTaskCheck(filepath);
			this.plugin.syncLockManager.release();
		} catch (error) {
			console.error(`An error occurred while modifying the file: ${(error as Error).message}`);
			this.plugin.syncLockManager.release();
		} finally {
			this.plugin.isProcessingModify = false;
		}
	}

	async lineNumberCheck(): Promise<void> {
		if (this.plugin.isSyncingFromTodoist) return;
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const cursor = view.editor.getCursor();
		const line = cursor?.line;
		const fileContent = view.data;
		const fileName = view.app.workspace.activeEditor?.file?.name;
		const filepath = view.app.workspace.activeEditor?.file?.path;

		if (typeof this.plugin.lastLines === 'undefined' || typeof this.plugin.lastLines.get(fileName as string) === 'undefined') {
			this.plugin.lastLines.set(fileName as string, line as number);
			return;
		}

		if (this.plugin.lastLines.has(fileName as string) && line !== this.plugin.lastLines.get(fileName as string)) {
			const lastLine = this.plugin.lastLines.get(fileName as string);
			if (this.plugin.settings.debugMode) {
				this.plugin.debugLog('Line changed!', `current line is ${line}`, `last line is ${lastLine}`);
			}

			const lastLineText = view.editor.getLine(lastLine as number);
			if (!await this.plugin.checkModuleClass()) return;
			this.plugin.lastLines.set(fileName as string, line as number);

			try {
				if (!await this.plugin.syncLockManager.acquire('obsidianToTodoist')) return;
				await this.plugin.obsidianToTodoist!.lineModifiedTaskCheck(filepath as string, lastLineText, lastLine as number, fileContent);
				this.plugin.syncLockManager.release();
			} catch (error) {
				console.error(`An error occurred while check modified task in line text: ${error}`);
				this.plugin.syncLockManager.release();
			}
		}
	}

	async checkboxEventHandle(evt: MouseEvent): Promise<void> {
		if (!await this.plugin.checkModuleClass()) return;

		const target = evt.target as HTMLInputElement;
		const taskElement = target.closest('div');
		if (!taskElement) return;

		const regex = /\[todoist_id::\s*(\w+)\]/;
		const match = taskElement.textContent?.match(regex) || false;

		if (match) {
			const taskId = (match as RegExpMatchArray)[1];
			if (!this.plugin.cacheOperation?.isTaskSyncEnabled(taskId)) return;
			if (!await this.plugin.syncLockManager.acquire('obsidianToTodoist')) return;
			try {
				if (target.checked) {
					await this.plugin.obsidianToTodoist!.closeTask(taskId);
				} else {
					await this.plugin.obsidianToTodoist!.repoenTask(taskId);
				}
			} catch (error) {
				console.error(`An error occurred while toggling task: ${error}`);
			} finally {
				this.plugin.syncLockManager.release();
			}
		} else {
			const filepath = this.plugin.app.workspace.getActiveFile()?.path;
			if (!filepath) return;
			if (!await this.plugin.syncLockManager.acquire('obsidianToTodoist')) return;
			try {
				await this.plugin.obsidianToTodoist!.fullTextModifiedTaskCheck(filepath);
			} catch (error) {
				console.error(`An error occurred while check modified tasks in the file: ${error}`);
			} finally {
				this.plugin.syncLockManager.release();
			}
		}
	}
}
