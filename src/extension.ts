import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { ResolverFactory } from 'enhanced-resolve'
import Resolver = require('enhanced-resolve/lib/Resolver')

let configFileName = '.resolve.conf.js'

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

function getWebpack(): Promise<vscode.WorkspaceFolder> {
	let folders = vscode.workspace.workspaceFolders
	if (!folders) {
		vscode.window.showErrorMessage('An VSCode Resolve configuration can only be generated if VS Code is opened on a workspace folder.')
		return Promise.reject()
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
		return Promise.reject()
	}

	return new Promise((resolve, reject) => {
		pickFolder(configFolders, 'Select a workspace folder to generate a resolve configuration for').then(async (folder) => {
			if (!folder) {
				return reject()
			}
			resolve(folder)
		})
	})
}

class DefinitionProvider implements vscode.DefinitionProvider {
	provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.DefinitionLink[]> {
		return new Promise(async (resolve, reject) => {
			try {
				const folder = await getWebpack()
				if (!folder) {
					return reject()
				}
				const folderPath = folder.uri.fsPath
				const config = require(path.join(folderPath, configFileName))
				const resolver = await getResolver(config)()
				const range = document.getWordRangeAtPosition(position, /('|"|\()[^'"\s]+('|"|\))/)
				const request = document.getText(range)
				if (range && request) {
					resolver.resolve({}, path.parse(document.fileName).dir, request.substr(1, request.length - 2), {}, (err: any, filepath: string) => {
						if (err || !filepath) {
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
			} catch (err) {
				console.error(err)
				reject(err)
			}
		})
	}
}

export function activate(context: vscode.ExtensionContext) {
	const registerDefinitionProvider = vscode.languages.registerDefinitionProvider({
		scheme: 'file',
		pattern: '**/*.{js,jsx,ts,tsx,vue,less,sass}'
	}, new DefinitionProvider())

	context.subscriptions.push(registerDefinitionProvider)
	vscode.workspace.onDidChangeConfiguration(() => {
		configFileName = vscode.workspace.getConfiguration('DefinitionResolve')
			.get('config.file.relative.path') || configFileName
	})
}

function getResolver(options: ResolverFactory.ResolverOption): Function {
	let resolver: Resolver

	return function () {
		if (resolver) {
			return resolver
		} else {
			return ResolverFactory.createResolver({
				...options,
				fileSystem: fs
			})
		}
	}
}
