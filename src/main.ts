import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'

import { Logger } from './components/logger'
import { CompletionWatcher, Completer } from './components/completionWatcher'
import { Paster } from './components/paster'
import { WordCounter } from './components/wordCounter'
import { TikzCodeLense } from './providers/tikzcodelense'
import { MacroDefinitions } from './providers/macroDefinitions'
import { TikzPictureView } from './components/tikzpreview'
import { Zotero } from './components/zotero'
import * as utils from './utils'

import TelemetryReporter from 'vscode-extension-telemetry'

let extension: Extension

export function activate(context: vscode.ExtensionContext) {
    extension = new Extension()

    extension.logger.addLogMessage('LaTeX Utilities Started')

    context.subscriptions.push(
        vscode.commands.registerCommand('latex-utilities.editLiveSnippetsFile', () =>
            extension.completionWatcher.editSnippetsFile()
        ),
        vscode.commands.registerCommand('latex-utilities.resetLiveSnippetsFile', () =>
            extension.completionWatcher.resetSnippetsFile()
        ),
        vscode.commands.registerCommand('latex-utilities.compareLiveSnippetsFile', () =>
            extension.completionWatcher.compareSnippetsFile()
        ),
        vscode.commands.registerCommand('latex-utilities.formattedPaste', () => extension.paster.paste()),
        vscode.commands.registerCommand('latex-utilities.countWord', () => extension.wordCounter.count()),
        vscode.commands.registerCommand('latex-utilities.viewtikzpicture', (document, range) =>
            extension.tikzPreview.view(document, range)
        ),
        vscode.commands.registerCommand('latex-utilities.citeZotero', () => extension.zotero.cite()),
        vscode.commands.registerCommand('latex-utilities.openInZotero', () => extension.zotero.openCitation()),
        vscode.commands.registerCommand('latex-utilities.selectWordcountFormat', () =>
            extension.wordCounter.pickFormat()
        )
    )

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(
            (e: vscode.TextDocumentChangeEvent) => {
                if (utils.hasTexId(e.document.languageId)) {
                    extension.completionWatcher.watcher(e)
                    extension.tikzPreview.onFileChange(e.document, e.contentChanges)
                }
            },
            undefined,
            [new vscode.Disposable(extension.tikzPreview.cleanupTempFiles)]
        ),
        vscode.workspace.onDidSaveTextDocument((e: vscode.TextDocument) => {
            if (e.uri.fsPath === extension.completionWatcher.snippetFile.user) {
                extension.completionWatcher.loadSnippets(true)
            } else {
                extension.wordCounter.setStatus()
            }
        }),
        vscode.workspace.onDidCloseTextDocument((e: vscode.TextDocument) => {
            if (e.uri.fsPath.includes(extension.completionWatcher.snippetFile.user)) {
                extension.completionWatcher.determineIfUserSnippetsRedundant()
            }
        }),
        vscode.window.onDidChangeActiveTextEditor((_e: vscode.TextEditor | undefined) => {
            extension.wordCounter.setStatus()
        })
    )

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider({ scheme: 'file', language: 'tex' }, extension.completer),
        vscode.languages.registerCompletionItemProvider({ scheme: 'file', language: 'latex' }, extension.completer),
        vscode.languages.registerCompletionItemProvider({ scheme: 'file', language: 'doctex' }, extension.completer),
        vscode.languages.registerCodeLensProvider({ language: 'latex', scheme: 'file' }, new TikzCodeLense()),
        vscode.languages.registerDefinitionProvider(
            { language: 'latex', scheme: 'file' },
            new MacroDefinitions(extension)
        )
    )

    newVersionMessage(context.extensionPath)
    context.subscriptions.push(extension.telemetryReporter)
}

export function deactivate() {
    extension.tikzPreview.cleanupTempFiles()
    extension.telemetryReporter.dispose()
}

function newVersionMessage(extensionPath: string) {
    fs.readFile(`${extensionPath}${path.sep}package.json`, (err, data) => {
        if (err) {
            extension.logger.addLogMessage('Cannot read package information.')
            return
        }
        extension.packageInfo = JSON.parse(data.toString())
        extension.logger.addLogMessage(`LaTeX Utilities version: ${extension.packageInfo.version}`)
        if (
            fs.existsSync(`${extensionPath}${path.sep}VERSION`) &&
            fs.readFileSync(`${extensionPath}${path.sep}VERSION`).toString() === extension.packageInfo.version
        ) {
            return
        }
        fs.writeFileSync(`${extensionPath}${path.sep}VERSION`, extension.packageInfo.version)
        const configuration = vscode.workspace.getConfiguration('latex-utilities')
        // todo: remove me after next update
        if (fs.existsSync(extension.completionWatcher.snippetFile.user)) {
            vscode.window
                .showWarningMessage(
                    'LaTeX Utilities default LiveSnippets default has changed significantly',
                    'Reset to new defaults',
                    'Compare my snippets to default',
                    'Ignore'
                )
                .then(option => {
                    switch (option) {
                        case 'Reset to new defaults':
                            vscode.commands.executeCommand('latex-utilities.resetLiveSnippetsFile')
                            break
                        case 'Compare my snippets to default':
                            vscode.commands.executeCommand('latex-utilities.compareLiveSnippetsFile')
                            vscode.window
                                .showWarningMessage(
                                    'What do you want to do?',
                                    'Reset to new defaults (keeps copy of old)',
                                    'Leave my snippets alone'
                                )
                                .then(opt => {
                                    if (opt === 'Reset to new defaults (keeps copy of old)') {
                                        vscode.commands.executeCommand('latex-utilities.resetLiveSnippetsFile')
                                    }
                                })
                            break
                        default:
                            break
                    }
                })
        }
        //
        if (!(configuration.get('message.update.show') as boolean)) {
            return
        }
        vscode.window
            .showInformationMessage(
                `LaTeX Utilities updated to version ${extension.packageInfo.version}.`,
                'Change log',
                'Star the project',
                'Disable this message'
            )
            .then(option => {
                switch (option) {
                    case 'Change log':
                        vscode.commands.executeCommand(
                            'markdown.showPreview',
                            vscode.Uri.file(`${extensionPath}${path.sep}CHANGELOG.md`)
                        )
                        break
                    case 'Star the project':
                        vscode.commands.executeCommand(
                            'vscode.open',
                            vscode.Uri.parse('https://github.com/tecosaur/LaTeX-Utilities/')
                        )
                        break
                    case 'Disable this message':
                        configuration.update('message.update.show', false, true)
                        break
                    default:
                        break
                }
            })
    })
}

export class Extension {
    extensionRoot: string
    packageInfo: any
    telemetryReporter: TelemetryReporter
    workshop: LaTeXWorkshopAPI
    logger: Logger
    completionWatcher: CompletionWatcher
    completer: Completer
    paster: Paster
    wordCounter: WordCounter
    tikzPreview: TikzPictureView
    zotero: Zotero

    constructor() {
        this.extensionRoot = path.resolve(`${__dirname}/../../`)
        const self = vscode.extensions.getExtension('tecosaur.latex-utilities') as vscode.Extension<any>
        this.telemetryReporter = new TelemetryReporter(
            'tecosaur.latex-utilities',
            self.packageJSON.version,
            '015dde22-1297-4bc0-8f8d-6587f3c192ec'
        )
        const workshop = vscode.extensions.getExtension('james-yu.latex-workshop') as vscode.Extension<any>
        this.workshop = workshop.exports
        if (workshop.isActive === false) {
            workshop.activate().then(() => (this.workshop = workshop.exports))
        }
        this.logger = new Logger(this)
        this.completionWatcher = new CompletionWatcher(this)
        this.completer = new Completer(this)
        this.paster = new Paster(this)
        this.wordCounter = new WordCounter(this)
        this.tikzPreview = new TikzPictureView(this)
        this.zotero = new Zotero(this)
    }
}

interface LaTeXWorkshopAPI {
    getRootFile: () => string
    getGraphicsPath: () => string[]
    viewer: {
        clients: {
            [key: string]: {
                viewer: 'browser' | 'tab'
                websocket: unknown
                position?: {}
            }[]
        }
        refreshExistingViewer(sourceFile?: string, viewer?: string): boolean
        openTab(sourceFile: string, respectOutDir: boolean, sideColumn: boolean): void
    }
    manager: {
        setEnvVar: () => void
        findRoot: () => Promise<string | undefined>
        rootDir: () => string
        rootFile: () => string
    }
    completer: {
        command: {
            usedPackages: () => string[]
        }
    }
}
