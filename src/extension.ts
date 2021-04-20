import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { ResolverFactory } from 'enhanced-resolve'
import Resolver = require('enhanced-resolve/lib/Resolver')
import { AbstractInputFileSystem } from 'enhanced-resolve/lib/common-types'

class ConfigLoad {
    watcher: vscode.FileSystemWatcher | undefined  = undefined
    cache = new Map()

    loadData (filePath: string) {
        return {}
    }

    getConfig (filePath: string) {
        const root = path.parse(filePath).dir
        if (this.cache.has(root)) {
            return this.cache.get(root)
        }
    }

    updateWatcher (fileName: string) {
        // 更新watcher
        let confWatcher = this.watcher
        if (confWatcher) {
            confWatcher.dispose()
        }
        confWatcher = this.watcher = vscode.workspace.createFileSystemWatcher(`**/${fileName}`)
        confWatcher.onDidChange(({fsPath: filePath}) => {
            const root = path.parse(filePath).dir
            if (this.cache.has(root)) {
                this.cache.set(root, this.loadData(filePath))
            }
        })
        confWatcher.onDidCreate(({fsPath: filePath}) => {
            const root = path.parse(filePath).dir
            if (this.cache.has(root)) {
                this.cache.set(root, this.loadData(filePath))
            }
        })
        confWatcher.onDidDelete(({fsPath: filePath}) => {
            const root = path.parse(filePath).dir
            if (this.cache.has(root)) {
                this.cache.set(root, null)
            }
        })

        this.cache = new Map()
        for (const folder of vscode.workspace.workspaceFolders || []) {
            const filePath = path.join(folder.uri.fsPath, fileName)
            if (fs.existsSync(filePath)) {
                const fileData = this.loadData(filePath)
                this.cache.set(folder.uri.fsPath, fileData)
            } else {
                this.cache.set(folder.uri.fsPath, null)
            }
        }
    }
}

class PackageConfig extends ConfigLoad {
    constructor () {
        super()
        this.updateWatcher('package.json')
    }

    loadData (filePath: string) {
        const pa = require(filePath)

        return pa.alias || {}
    }
}

class FileConfig extends ConfigLoad {
    fileName = '.resolve.conf.js'

    constructor (fileName: string | undefined) {
        super()
        this.changeFileName(fileName)
    }

    loadData (filePath: string) {
        return require(filePath)
    }

    changeFileName (fileName: string | undefined) {
        if (fileName && fileName != this.fileName) {
            this.fileName = fileName

            this.updateWatcher(fileName)
        }
    }
}

class DefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position, 
    ): Thenable<vscode.DefinitionLink[]> {
        /* eslint-disable-next-line no-async-promise-executor */
        return new Promise(async (resolve, reject) => {
            try {
                if (!this._isOpen) {
                    return reject()
                }

                const currFileName = document.fileName
                const resolver = await getResolver(this.getConfig(currFileName))()
                const currDir = path.parse(currFileName).dir
                const regex = (currFileName.endsWith('ss') || currFileName.startsWith('styl'))
                    ? /['"(][^'"()\s]+['")]/
                    : /['"][^'"\s]+['"]/

                const range = document.getWordRangeAtPosition(position, regex)
                const request = document.getText(range)
                const rangeTxt = request.substr(1, request.length - 2)
                if (range && request) {
                    resolver.resolve({}, currDir, rangeTxt, (err: Error|null|undefined, filepath: string) => {
                        if (err || !filepath) {
                            return reject()
                        }
                        // 过滤默认跳转
                        const pathPath = path.resolve(currDir, rangeTxt)
                        const pathJsPath = pathPath + '.js'
                        if (
                            (filepath === pathPath || filepath === pathJsPath)
                            && filepath.endsWith('.js')
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

    _fileConfig: FileConfig | undefined = undefined
    _defaultConfig: ResolverFactory.ResolverOption | undefined = undefined
    _isOpen = true
    _packageConfig: PackageConfig | undefined = undefined

    getConfig (filePath: string) {
        const folderPath = (vscode.workspace.workspaceFolders || []).find((folder) => {
            return filePath.startsWith(folder.uri.fsPath)
        })?.uri.fsPath

        if (!folderPath) return


        const fileConfig = this._fileConfig && this._fileConfig.getConfig(filePath)
        if (fileConfig) {
            return fileConfig
        } else {
            let config: ResolverFactory.ResolverOption
            config = this._defaultConfig || {
                extensions: [
                    '.js',
                    '.vue',
                    '.json'
                ],
                alias: {
                    'vue$': 'vue/dist/vue.esm.js',
                    '@': '$root$/src'
                }
            }
            config = JSON.parse(
                JSON.stringify(config)
                    .replace(/:"\$root\$(.*)"/, `:"${path.resolve(folderPath)}$1"`)
            )
            config.alias = {
                ...config.alias,
                ...(this._packageConfig && this._packageConfig.getConfig(filePath) || {}),
            }

            return config
        }
    }

    async initConfig(): Promise<void> {
        this._fileConfig = new FileConfig(getConfigFileName())
        this._defaultConfig = getDefaultConfig()
        this._isOpen = getOpenConfig()


        // 修改编辑器配置
        vscode.workspace.onDidChangeConfiguration(() => {
            if (this._fileConfig) {
                this._fileConfig.changeFileName(getConfigFileName())
            }
            this._defaultConfig = getDefaultConfig()
            this._isOpen = getOpenConfig()
        })

        this._packageConfig = new PackageConfig()
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const definitionProvider = new DefinitionProvider()
    const registerDefinitionProvider = vscode.languages.registerDefinitionProvider({
        scheme: 'file',
        pattern: '**/*.{jade,coffee,cjs,mjs,js,jsx,ts,tsx,vue,less,sass,scss,stylus,styl,wxss,wxml,wxs,json}'
    }, definitionProvider)

    context.subscriptions.push(registerDefinitionProvider)

    definitionProvider.initConfig()
}

function getOpenConfig (): boolean {
    return !!vscode.workspace.getConfiguration('DefinitionResolve')
    .get('open')
}

function getDefaultConfig (): ResolverFactory.ResolverOption | undefined {
    return vscode.workspace.getConfiguration('DefinitionResolve')
        .get('default.resolve')
}

function getConfigFileName (): string | undefined {
    return vscode.workspace.getConfiguration('DefinitionResolve')
    .get('config.file.relative.path')
}

function getResolver(options: ResolverFactory.ResolverOption): () => Resolver {
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
