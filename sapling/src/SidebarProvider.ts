/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import { getNonce } from './helpers/getNonce';
import { SaplingParser } from './SaplingParser';
import { Tree, SerializedTree } from './types';
import { SaplingSettings } from './types/SaplingSettings';

// Sidebar class that creates a new instance of the sidebar + adds functionality with the parser
export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  _doc?: vscode.TextDocument;
  tree: Tree;
  settings: SaplingSettings;
  private readonly _extensionUri: vscode.Uri;
  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this._extensionUri = context.extensionUri;

    // Check for sapling state in workspace if available
    const treeState: SerializedTree | undefined = context.workspaceState.get('sapling');
    if (treeState) this.tree = Tree.deserialize(treeState);

    // Check for sapling settings state in workspace if available
    const settingsState: SaplingSettings | undefined =
      context.workspaceState.get('saplingSettings');
    const workspace = vscode.workspace.workspaceFolders;
    let workspaceRoot = '';
    if (workspace) {
      workspaceRoot = workspace[0].uri.fsPath;
    }
    this.settings = new SaplingSettings(
      settingsState || {
        useAlias: false,
        appRoot: workspaceRoot,
        webpackConfig: '',
        tsConfig: '',
      }
    );

    // Initialise parser
    if (treeState) {
      this.tree = SaplingParser.parse(treeState.filePath, this.settings);
    } else {
      this.tree = SaplingParser.parse('', this.settings);
    }
  }

  // Instantiate the connection to the webview
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Event listener that triggers any moment that the user changes his/her settings preferences
    vscode.workspace.onDidChangeConfiguration(async () => {
      // Get the current settings specifications the user selects
      const settings = vscode.workspace.getConfiguration('sapling');
      // Send a message back to the webview with the data on settings
      await webviewView.webview.postMessage({
        type: 'preferences-data',
        value: settings.view,
      });
    });

    // Event listener that triggers whenever the user changes their current active window
    vscode.window.onDidChangeActiveTextEditor(async (e) => {
      // Post a message to the webview with the file path of the user's current active window
      await webviewView.webview.postMessage({
        type: 'current-tab',
        value: e ? e.document.fileName : undefined,
      });
    });

    // Event listener that triggers whenever the user saves a document
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      // Edge case that avoids sending messages to the webview when there is no tree currently populated
      if (!this.tree?.filePath) {
        return;
      }
      // Post a message to the webview with the newly parsed tree
      this.tree.updateOnSave(document.fileName);
      await this.updateView();
    });

    // Reaches out to the project file connector function below
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Message switch case that will listen for messages sent from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      let rootPath;
      let filePath;
      // Switch cases based on the type sent as a message
      switch (data.type) {
        // Case when user alters parser settings in webview
        case 'settings': {
          if (!data.value) {
            return;
          }
          switch (data.value[0]) {
            case 'useAlias':
              this.settings.updateSettings('useAlias', data.value[1]);
              break;

            case 'appRoot':
              rootPath = await SidebarProvider.selectFile(false, true);
              if (!rootPath) {
                return;
              }
              this.settings.updateSettings('appRoot', rootPath);
              break;

            case 'webpackConfig':
            case 'tsConfig':
              filePath = await SidebarProvider.selectFile();
              if (!filePath) {
                return;
              }
              this.settings.updateSettings(data.value[0], filePath);
              break;
          }

          // Store updated settings in workspace
          await this.context.workspaceState.update('saplingSettings', this.settings);

          if (this.settings.validateSettings()) {
            // in-place parsing for this.tree
            SaplingParser.parse(this.tree, this.settings);
          }
          await this.updateView();
          break;
        }

        // Case when the user selects a file to begin a tree
        case 'onFile': {
          // Get filePath via vscode file selector
          filePath = await SidebarProvider.selectFile();

          // If no file picked or selection fails, do nothing
          if (!filePath) {
            return;
          }
          // Update parser entry file and re-run
          this.tree = SaplingParser.parse(filePath, this.settings);
          await this.updateView();
          break;
        }

        // Case when clicking on tree to open file
        case 'onViewFile': {
          if (!data.value) {
            return;
          }
          // Open and the show the user the file they want to see
          const doc = await vscode.workspace.openTextDocument(data.value);
          await vscode.window.showTextDocument(doc, {
            preserveFocus: false,
            preview: false,
          });
          break;
        }

        // Case when sapling becomes visible in sidebar
        case 'onSaplingVisible': {
          // Send webview current view data
          await this.updateView();
          break;
        }

        // Case to retrieve the user's settings
        case 'onPreferencesAcquire': {
          // use getConfiguration to check what the current settings are for the user
          const settings = vscode.workspace.getConfiguration('sapling');
          // send a message back to the webview with the data on settings
          await webviewView.webview.postMessage({
            type: 'preferences-data',
            value: settings.view,
          });
          break;
        }

        // Case that changes the parser's recorded node expanded/collapsed structure
        case 'onNodeToggle': {
          if (!this.tree.entryFile) {
            return;
          }
          this.tree.findAndToggleExpanded(data.value.id);
          // let the parser know that the specific node clicked changed it's expanded value, save in state
          await this.updateView();
          break;
        }

        // Message sent to the webview to bold the active file
        case 'onBoldCheck': {
          // If no view then return:
          if (!this._view) {
            return;
          }
          // Check there is an activeText Editor
          const fileName = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.document.fileName
            : null;
          // Message sent to the webview to bold the active file
          if (fileName) {
            await this._view.webview.postMessage({
              type: 'current-tab',
              value: fileName,
            });
          }
          break;
        }
      }
    });
  }

  // Called when Generate Tree command triggered by status button or explorer context menu
  public statusButtonClicked = async (uri: vscode.Uri | undefined): Promise<void> => {
    let fileName: string;

    // If status menu button clicked, no uri, get active file uri
    if (!uri) {
      // If no active text editor, do nothing
      if (!vscode.window.activeTextEditor) {
        return;
      }
      fileName = vscode.window.activeTextEditor.document.fileName;
    } else {
      fileName = uri.path;
    }

    // Parse new tree with active file as root
    if (fileName) {
      this.tree = SaplingParser.parse(fileName, this.settings);
      await this.updateView();
    }
  };

  // Method called by VS Code clearWorkSpaceSettings command
  // Clears Sapling workspace state and refreshes webview
  public clearWorkSpaceState = async (): Promise<void> => {
    await this.context.workspaceState.update('sapling', undefined);
    // Reset to default settings:
    const workspace = vscode.workspace.workspaceFolders;
    let workspaceRoot = '';
    if (workspace) {
      workspaceRoot = workspace[0].uri.fsPath;
    }
    const settings = {
      useAlias: false,
      appRoot: workspaceRoot,
      webpackConfig: '',
      tsConfig: '',
    };
    await this.context.workspaceState.update('saplingSettings', settings);
    this.settings = new SaplingSettings(settings);
    this.tree = SaplingParser.parse('', this.settings);
    await this.updateView();
  };

  // revive statement for the webview panel
  public revive(panel: vscode.WebviewView): void {
    this._view = panel;
  }

  // Helper method to send updated tree data to view, and saves current tree to workspace
  private async updateView() {
    // If parser or webview do not exist, do nothing
    if (!this.tree || !this._view) {
      return;
    }
    const treeData = this.tree.serialize();
    // Save current state of tree to workspace state:
    await this.context.workspaceState.update('sapling', treeData);
    // Send updated tree to webview
    await this._view.webview.postMessage({
      type: 'parsed-data',
      value: treeData,
    });

    // Send current settings to webview
    await this._view.webview.postMessage({
      type: 'settings-data',
      value: this.settings,
    });
  }

  // Helper method to open VSCode file picking dialog
  private static async selectFile(
    selectMany: boolean = false,
    selectFolders: boolean = false
  ): Promise<string | null> {
    // Open vscode file-selector dialog
    const uri = await vscode.window.showOpenDialog({
      canSelectMany: selectMany,
      canSelectFolders: selectFolders,
    });

    // Edge case if selector doesn't work / no file picked
    if (!uri) {
      return Promise.resolve(null);
    }

    // Convert uri to path string and return
    return Promise.resolve(uri[0].fsPath);
  }

  // paths and return statement that connects the webview to React project files
  private _getHtmlForWebview(webview: vscode.Webview) {
    const styleResetUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'))
      .toString();
    const styleVSCodeUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'))
      .toString();
    const styleMainUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css'))
      .toString();

    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'sidebar.js'))
      .toString();

    // Use a nonce to only allow a specific script to be run.
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <!--
          Use a content security policy to only allow loading images from https or from our extension directory,
          and only allow scripts that have a specific nonce.
        -->
        <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
          style-src 'unsafe-inline' ${webview.cspSource};
          img-src ${webview.cspSource} https:;
          script-src 'nonce-${nonce}';">
          <link href="${styleResetUri}" rel="stylesheet">
          <link href="${styleVSCodeUri}" rel="stylesheet">
          <link href="${styleMainUri}" rel="stylesheet">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script nonce="${nonce}">
          const tsvscode = acquireVsCodeApi();
        </script>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
