import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { ResolverFactory } from 'enhanced-resolve'
import Resolver = require('enhanced-resolve/lib/Resolver')
import { AbstractInputFileSystem } from 'enhanced-resolve/lib/common-types'

let configFileName = getConfigFileName()
let defaultConfig = getDefaultConfig()
let isOpen = getOpenConfig()

interface WorkspaceFolderItem extends vscode.QuickPickItem {
	folder: vscode.WorkspaceFolder
}

function pickFolder(folders: vscode.WorkspaceFolder[], placeHolder: string): Thenable<vscode.WorkspaceFolder | undefined> {
	if (folders.length === 1) {
		return Promise.resolve(folders[0])
	}

	return vscode.window.showQuickPick(
		folders.map<WorkspaceFolderItem>((folder) => { return { label: folder.name, description: folder.uri.fsPath, folder: folder } }),
		{ placeHolder: placeHolder }
	).then((selected) => {
		if (!selected) {
			return undefined
		}
		return selected.folder
	})
}

function getConfigFolder(): Promise<vscode.WorkspaceFolder> {
	return new Promise((resolve, reject) => {
		let folders = vscode.workspace.workspaceFolders
		if (!folders) {
			vscode.window.showErrorMessage('An VSCode Resolve configuration can only be generated if VS Code is opened on a workspace folder.')
			return resolve()
		}
		let configFolders = folders.filter(folder => {
			let configFiles = [configFileName]
			for (let configFile of configFiles) {
				if (fs.existsSync(path.join(folder.uri.fsPath, configFile))) {
					return true
				}
			}
			return false
		})
		if (configFolders.length === 0) {
			configFolders = folders
		}

		pickFolder(configFolders, 'Select a workspace folder to generate a resolve configuration for').then(async (folder) => {
			if (!folder) {
				return resolve()
			}
			resolve(folder)
		})
	})
}

class DefinitionProvider implements vscode.DefinitionProvider {
	provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.DefinitionLink[]> {
		return new Promise(async (resolve, reject) => {
			try {
				if (!isOpen) {
					return reject()
				}

				const folder = await getConfigFolder()
				let config: ResolverFactory.ResolverOption
				if (folder) {
					const folderPath = folder.uri.fsPath
					if (fs.existsSync(path.join(folder.uri.fsPath, configFileName))) {
						config = require(path.join(folderPath, configFileName))
					} else {
						config = defaultConfig || {
							extensions: ['.js', '.vue', '.json'],
							alias: {
								'vue$': 'vue/dist/vue.esm.js',
								'@': '$root$/src'
							}
						}
						config = JSON.parse(
							JSON.stringify(config)
								.replace(/:"\$root\$(.*)"/, `:"${path.resolve(folderPath)}$1"`)
						)
					}
				} else {
					return reject()
				}

				const resolver = await getResolver(config)()
				const currFileName = document.fileName
				const currDir = path.parse(currFileName).dir
				const regex = (currFileName.endsWith('ss') || currFileName.startsWith('styl'))
					? /['"(][^'"()\s]+['")]/
					: /['"][^'"\s]+['"]/

				const range = document.getWordRangeAtPosition(position, regex)
				const request = document.getText(range)
				const rangeTxt = request.substr(1, request.length - 2)
				if (range && request) {
					resolver.resolve({}, currDir, rangeTxt, {}, (err: any, filepath: string) => {
						if (err || !filepath) {
							return reject()
						}
						// 过滤默认跳转
						const pathPath = path.resolve(currDir, rangeTxt)
						const pathJsPath = pathPath + '.js'
						if (
							(filepath === pathPath || filepath === pathJsPath)
							&& (filepath.endsWith('.js') || path.parse(filepath).ext === path.parse(currFileName).ext)
						) {
							return reject()
						}
						resolve([{
							originSelectionRange: range,
							targetUri: vscode.Uri.file(filepath),
							targetRange: new vscode.Range(0, 0, 0, 0)
						}])
					})
				} else {
					reject()
				}
			} catch (_) {
				reject()
			}
		})
	}
}

export function activate(context: vscode.ExtensionContext) {
	const registerDefinitionProvider = vscode.languages.registerDefinitionProvider({
		scheme: 'file',
		pattern: '**/*.{js,jsx,ts,tsx,vue,less,sass,scss,stylus,styl,wxss,wxml,wxs}'
	}, new DefinitionProvider())

	context.subscriptions.push(registerDefinitionProvider)
	vscode.workspace.onDidChangeConfiguration(() => {
		configFileName = getConfigFileName()
		defaultConfig = getDefaultConfig()
		isOpen = getOpenConfig()
	})
}

function getOpenConfig (): boolean {
	return !!vscode.workspace.getConfiguration('DefinitionResolve')
	.get('open')
}

function getDefaultConfig (): ResolverFactory.ResolverOption | undefined {
	return vscode.workspace.getConfiguration('DefinitionResolve')
		.get('default.resolve')
}

function getConfigFileName (): string {
	return vscode.workspace.getConfiguration('DefinitionResolve')
	.get('config.file.relative.path') || configFileName || '.resolve.conf.js'
}

function getResolver(options: ResolverFactory.ResolverOption): Function {
	let resolver: Resolver

	return function () {
		if (resolver) {
			return resolver
		} else {
			return ResolverFactory.createResolver({
				...options,
				fileSystem: <AbstractInputFileSystem>fs
			})
		}
	}
}
