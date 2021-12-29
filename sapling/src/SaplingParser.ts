/* eslint-disable @typescript-eslint/no-unsafe-argument */
import * as path from 'path';
import * as fs from 'fs';
import * as cabinet from 'filing-cabinet';
import { create as ResolverCreator } from 'enhanced-resolve';

import { parse as babelParse } from '@babel/parser';
import {
  Node as ASTNode,
  isIdentifier,
  isStringLiteral,
  isImportDeclaration,
  isVariableDeclaration,
  isImportSpecifier,
  isImportDefaultSpecifier,
  isImportNamespaceSpecifier,
  isCallExpression,
  isImport,
  isArrayPattern,
  isObjectPattern,
  isObjectProperty,
  ImportDeclaration,
  VariableDeclaration,
} from '@babel/types';
import { Tree, Token, ImportData } from './types';
import { SaplingSettings } from './types/SaplingSettings';

import { filePathFixer } from './helpers/filePathFixer';
import { getNonce } from './helpers/getNonce';

const defaultSettings = {
  useAlias: false,
  appRoot: '',
  webpackConfig: '',
  tsConfig: '',
};

export class SaplingParser {
  entryFile: string;
  settings: SaplingSettings;
  tree: Tree | undefined;
  aliases: string[];
  wpResolver: Function | undefined;

  constructor(filePath: string, settings: SaplingSettings = { ...defaultSettings }) {
    if (filePath) {
      // Ensure correct file path for root file when selected in webview:
      this.entryFile = filePathFixer(filePath);
    } else {
      this.entryFile = '';
    }

    // Set parser settings on new instance of parser
    this.settings = settings;

    // If settings include webpack Config, try to create resolver
    if (this.settings.webpackConfig) {
      this.createWpResolver();
    }

    this.aliases = [];
    this.updateAliases();

    this.tree = undefined;
  }

  // Set a new entryFile for the parser (root of component hierarchy)
  public setEntryFile(filePath: string): void {
    this.entryFile = filePathFixer(filePath);
  }

  // Update parser settings when changed in webview
  public updateSettings(setting: string, value: boolean | string): void {
    this.settings = { ...this.settings, [setting]: value };
    if (setting === 'webpackConfig') {
      this.createWpResolver();
    }
    this.updateAliases();
  }

  // Returns true if current settings are valid for parsing otherwise false
  public validSettings(): boolean {
    if (!this.entryFile) {
      return false;
    }

    if (!this.settings.useAlias || (this.settings.useAlias && this.settings.appRoot)) {
      return true;
    }
    return false;
  }

  // Public method to generate component tree based on current entryFile
  public parse(): Tree {
    // Create root Tree node
    const root = {
      id: getNonce(),
      name: path.basename(this.entryFile).replace(/\.[jt]sx?$/, ''),
      fileName: path.basename(this.entryFile),
      filePath: this.entryFile,
      importPath: '/', // this.entryFile here breaks windows file path on root e.g. C:\\ is detected as third party
      isExpanded: false,
      depth: 0,
      count: 1,
      isThirdParty: false,
      isReactRouter: false,
      hasReduxConnect: false,
      children: [],
      parentList: [],
      props: {},
      error: '',
    };

    this.tree = root;
    this.parser(root);
    return this.tree;
  }

  public getTree(): Tree | undefined {
    return this.tree;
  }

  // Set Sapling Parser with a specific Data Tree (from workspace state)
  public setTree(tree: Tree): void {
    this.entryFile = tree.filePath;
    this.tree = tree;
  }

  // Updates the tree when a file is saved in VS Code
  public updateTree(filePath: string): Tree | undefined {
    if (this.tree === undefined) {
      return this.tree;
    }

    type ChildInfo = {
      depth: number;
      filePath: string;
      isExpanded: boolean;
    };

    let children: Array<ChildInfo> = [];

    const getChildNodes = (node: Tree): void => {
      // eslint-disable-next-line @typescript-eslint/no-shadow
      const { depth, filePath, isExpanded } = node;
      children.push({ depth, filePath, isExpanded });
    };

    const matchExpand = (node: Tree): void => {
      for (let i = 0; i < children.length; i += 1) {
        const oldNode = children[i];
        if (
          oldNode.depth === node.depth &&
          oldNode.filePath === node.filePath &&
          oldNode.isExpanded
        ) {
          node.isExpanded = true;
        }
      }
    };

    const callback = (node: Tree): void => {
      if (node.filePath === filePath) {
        node.children.forEach((child) => {
          this.traverseTree(getChildNodes, child);
        });

        const newNode = this.parser(node);

        this.traverseTree(matchExpand, newNode);

        children = [];
      }
    };

    this.traverseTree(callback, this.tree);

    return this.tree;
  }

  // Traverses the tree and changes expanded property of node whose id matches provided id
  public toggleNode(id: string, expandedState: boolean): Tree | undefined {
    const callback = (node: Tree) => {
      if (node.id === id) {
        node.isExpanded = expandedState;
      }
    };

    this.traverseTree(callback, this.tree);

    return this.tree;
  }

  // Method to create enhanced-resolve resolver for webpack aliases
  private createWpResolver(): void {
    // Try to open provided webpack config file:
    let webpackObj;
    try {
      webpackObj = JSON.parse(fs.readFileSync(path.resolve(this.settings.webpackConfig), 'utf-8'));

      // Create new resolver to handle webpack aliased imports:
      this.wpResolver = ResolverCreator.sync({
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        ...webpackObj.resolve,
      });
    } catch (err) {
      console.log('Error while trying to load webpack config: ', err);
      this.settings.webpackConfig = '';
      this.wpResolver = undefined;
    }
  }

  // Method that extracts all aliases from tsconfig and webpack config files for parsing
  private updateAliases(): void {
    const aliases: string[] = [];
    if (this.settings.tsConfig) {
      // Try to open tsConfig file, if error then alert user in webview:
      let tsConfig;
      try {
        tsConfig = fs.readFileSync(path.resolve(this.settings.tsConfig), 'utf-8');
        // Strip any comments from the JSON before parsing:
        tsConfig = tsConfig.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) =>
          g ? '' : m
        );
        tsConfig = JSON.parse(tsConfig);
      } catch (err) {
        this.settings.tsConfig = '';
      }

      // If tsConfig contains path aliases, add aliases to parser aliases
      if (
        typeof tsConfig === 'object' &&
        tsConfig.compilerOptions &&
        tsConfig.compilerOptions.paths
      ) {
        Object.keys(tsConfig.compilerOptions.paths).forEach((key) => {
          // Remove asterix from end of alias if present
          key = key[key.length - 1] === '*' ? key.slice(0, key.length - 1) : key;
          if (key) {
            aliases.push(key);
          }
        });
      }
    }

    // Extract any webpack aliases for parsing
    if (this.settings.webpackConfig && this.wpResolver) {
      let wpObj;
      try {
        wpObj = JSON.parse(fs.readFileSync(this.settings.webpackConfig, 'utf-8'));
      } catch (err) {
        this.settings.webpackConfig = '';
      }
      if (typeof wpObj === 'object' && wpObj.resolve && wpObj.resolve.alias) {
        Object.keys(wpObj.resolve.alias).forEach((key) => {
          key = key[key.length - 1] === '$' ? key.slice(0, key.length - 1) : key;
          if (key) {
            aliases.push(key);
          }
        });
      }
    }

    this.aliases = aliases;
  }

  // Traverses all nodes of current component tree and applies callback to each node
  private traverseTree(callback: (node: Tree) => void, node: Tree | undefined = this.tree): void {
    if (!node) {
      return;
    }

    callback(node);

    node.children.forEach((childNode) => {
      this.traverseTree(callback, childNode);
    });
  }

  // Recursively builds the React component tree structure starting from root node
  private parser(componentTree: Tree): Tree {
    // If import is a node module, do not parse any deeper
    if (!['\\', '/', '.'].includes(componentTree.importPath[0])) {
      // Check that import path is not an aliased import
      const thirdParty = this.aliases.every(
        (alias) => componentTree.importPath.indexOf(alias) !== 0
      );

      if (thirdParty) {
        componentTree.isThirdParty = true;
        if (
          componentTree.fileName === 'react-router-dom' ||
          componentTree.fileName === 'react-router'
        ) {
          componentTree.isReactRouter = true;
        }
        return componentTree;
      }
    }

    // Check that file has valid fileName/Path, if not found, add error to node and halt
    const fileName = this.getFileName(componentTree);
    if (!fileName) {
      componentTree.error = 'File not found.';
      return componentTree;
    }

    // If current node recursively calls itself, do not parse any deeper:
    if (componentTree.parentList.includes(componentTree.filePath)) {
      return componentTree;
    }

    // Create abstract syntax tree of current component tree file
    let ast: ASTNode | Record<string, Array<Token>>;
    try {
      // See: https://babeljs.io/docs/en/babel-parser#options
      ast = babelParse(fs.readFileSync(path.resolve(componentTree.filePath), 'utf-8'), {
        sourceType: 'module',
        tokens: true, // default: false, tokens deprecated from babel v7
        plugins: ['jsx', 'typescript'],
        // TODO: additional plugins to look into supporting for future releases
        // 'importMeta': https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import.meta
        // 'importAssertions': parses ImportAttributes type
        // https://github.com/babel/babel/blob/main/packages/babel-parser/ast/spec.md#ImportAssertions
        allowImportExportEverywhere: true, // enables parsing dynamic imports
        attachComment: false, // performance benefits
      });
      // If no ast or ast tokens, error when parsing file
      if (!ast || !ast.tokens) {
        throw new Error();
      }
    } catch (err) {
      componentTree.error = 'Error while processing this file/node';
      return componentTree;
    }

    // Find imports in the current file, then find child components in the current file
    const imports = this.getImports(ast.program.body);

    // Get any JSX Children of current file:
    componentTree.children = this.getJSXChildren(ast.tokens, imports, componentTree);

    // Check if current node is connected to the Redux store
    componentTree.hasReduxConnect = this.checkForRedux(ast.tokens, imports);

    // Recursively parse all child components
    componentTree.children.forEach((child) => this.parser(child));

    return componentTree;
  }

  // Finds files where import string does not include a file extension
  private getFileName(componentTree: Tree): string | null {
    // If import aliasing is in use, correctly resolve file path with filing cabinet / enhanced resolve for non-root node files:
    if (this.settings.useAlias && componentTree.parentList.length) {
      let result = '';
      if (this.settings.tsConfig) {
        try {
          const options = {
            partial: componentTree.importPath,
            directory: this.settings.appRoot,
            filename: componentTree.parentList[0],
            tsConfig: this.settings.tsConfig,
          };

          result = cabinet(options);
        } catch (err) {
          return '';
        }
      }

      // Otherwise try webpack aliases if present:
      if (!result.length && this.settings.webpackConfig && this.wpResolver) {
        try {
          result = this.wpResolver(this.settings.appRoot, componentTree.importPath);
        } catch (err) {
          console.log('Error when trying to resolve file using webpack config: ', err);
        }
      }

      if (!result || path.basename(result) === `index.${path.extname(result)}`) {
        console.log('INDEX PATTERN DETECTED');
        componentTree.error = 'Error when trying to find filepath for this component';
      }

      componentTree.filePath = result;
      return result;
    }

    // Otherwise find correct JS/JSX/TS/TSX file with no aliasing if it exists
    const ext = path.extname(componentTree.filePath);
    if (!ext) {
      // Try and find file extension that exists in directory:
      try {
        const fileArray = fs.readdirSync(path.dirname(componentTree.filePath));
        const regEx = new RegExp(`${componentTree.fileName}\\.[jt]sx?$`);
        const fileName = fileArray.find((fileStr) => fileStr.match(regEx));
        return fileName ? (componentTree.filePath += path.extname(fileName)) : null;
      } catch (err) {
        console.log('Error trying to find specified file: ', err);
        return null;
      }
    } else {
      return componentTree.fileName;
    }
  }

  /* Extracts Imports from current file
   * https://github.com/babel/babel/blob/main/packages/babel-parser/ast/spec.md
   * https://github.com/babel/babel/blob/main/packages/babel-types/src/ast-types/generated/index.ts
   */
  private getImports(body: Array<ASTNode>): Record<string, ImportData> {
    return body
      .filter((astNode) => isImportDeclaration(astNode) || isVariableDeclaration(astNode))
      .reduce((accum: Record<string, ImportData>, declaration) => {
        return isImportDeclaration(declaration)
          ? Object.assign(accum, this.parseImportDeclaration(declaration))
          : isVariableDeclaration(declaration)
          ? Object.assign(accum, this.parseVariableDeclaration(declaration))
          : accum;
      }, {});
  }

  /* Import Declarations: 
   * e.g. import foo from "mod"
   '.source': name/path of imported module
   https://github.com/babel/babel/blob/main/packages/babel-parser/ast/spec.md#Imports
   */
  private parseImportDeclaration(declaration: ImportDeclaration): Record<string, ImportData> {
    const output: Record<string, ImportData> = {};
    let importName = '';
    let importAlias: string | undefined;

    const importPath = declaration.source.value;
    declaration.specifiers.forEach((specifier) => {
      /*
       * e.g. {foo} in import {foo} from "mod"
       * e.g. {foo as bar} in import {foo as bar} from "mod"
       '.imported': name of export (foo), '.local': local binding/alias (bar)
       */
      if (isImportSpecifier(specifier)) {
        if (isIdentifier(specifier.imported)) {
          if (specifier.imported.name === specifier.local.name) {
            importName = specifier.imported.name;
          } else {
            importName = specifier.imported.name;
            importAlias = specifier.local.name;
          }
          /* TODO: Add tests
           * Import entire module for side effects only (no values imported)
           * e.g. import '/modules/my-module.js';
           * e.g. import 'http:example.com\pears.js';
           */
        } else if (isStringLiteral(specifier.imported)) {
          importName = path.basename(specifier.imported.value);
        }
        /* TODO: Add individual imported components to tree, not just namespace or default specifier
         * default -  e.g. 'foo' in import foo from "mod.js"
         * namespace - e.g. '* as foo' in import * as foo from "mod.js"
         */
      } else if (isImportDefaultSpecifier(specifier) || isImportNamespaceSpecifier(specifier)) {
        importName = specifier.local.name;
      }

      // If alias is used, it will show up as identifier for node instances in body.
      // Therefore, alias will take precedence over name for parsed ast token values.
      output[importAlias || importName] = {
        importPath,
        importName,
        importAlias,
      };
    });
    return output;
  }

  /* Imports Inside Variable Declarations (and current support status): 
   * [x] e.g. const foo = require("module");
   * [v] e.g. const [foo, bar] = require("module");
   * [v] e.g. const { foo: alias, bar } = require("module");
   * [x] e.g. const promise = import("module");
   * [x] e.g. const [foo, bar] = await import("module");
   * [x] e.g. const { foo: bar } = Promise.resolve(import("module"));
   * [v] e.g. const foo = React.lazy(() => import('./module'));
   https://github.com/babel/babel/blob/main/packages/babel-parser/ast/spec.md#VariableDeclaration
   */
  private parseVariableDeclaration(declaration: VariableDeclaration): Record<string, ImportData> {
    const output: Record<string, ImportData> = {};
    let importName = '';
    let importAlias: string | undefined;
    /* 
    * VariableDeclarator:
    Left: Pattern <: Identifier or (ObjectPattern | ArrayPattern) -> destructuring 
    Right: CallExpression - When the callee property is of type 'Import', arguments must have only one 'Expression' type element
    https://github.com/babel/babel/blob/main/packages/babel-parser/ast/spec.md#VariableDeclarator
    https://github.com/babel/babel/blob/main/packages/babel-parser/ast/spec.md#Patterns
    https://github.com/babel/babel/blob/main/packages/babel-parser/ast/spec.md#CallExpression
    */
    declaration.declarations.forEach((declarator) => {
      const { id: LHS, init: RHS } = declarator;
      let importPath = '';

      // TODO: Support AwaitExpression, Promise.resolve(), then() chains for dynamic imports
      if (
        isCallExpression(RHS) &&
        (isImport(RHS.callee) || (isIdentifier(RHS.callee) && RHS.callee.name === 'require'))
      ) {
        // get importPath
        const importArg = RHS.arguments[0];
        importPath = isStringLiteral(importArg)
          ? importArg.value
          : isIdentifier(importArg) // almost certainly going to be StringLiteral, but guarding against edge cases
          ? importArg.name
          : '';
        if (!importPath.length) return;

        // e.g. const foo = import('module')
        // e.g. const foo = require('module')
        if (isIdentifier(LHS)) {
          importName = LHS.name;
          // e.g. const [foo, bar] = require('module');
        } else if (isArrayPattern(LHS)) {
          LHS.elements.forEach((element) => {
            if (element && isIdentifier(element)) {
              importName = element.name;
            }
            output[importName] = {
              importPath,
              importName,
            };
          });

          // e.g. const { foo } = require('module');
          // e.g. Aliasing: const { foo: bar } = require('module');
        } else if (isObjectPattern(LHS)) {
          LHS.properties.forEach((objectProperty) => {
            // assume rest parameters won't be used
            if (isObjectProperty(objectProperty)) {
              const { key: name, value: alias } = objectProperty;
              importName = isIdentifier(name) ? name.name : isStringLiteral(name) ? name.value : '';
              importAlias = isIdentifier(alias)
                ? alias.name
                : isStringLiteral(alias)
                ? alias.value
                : '';
              if (!importAlias.length || importName === importAlias) {
                importAlias = undefined;
              }
              output[importAlias || importName] = {
                importPath,
                importName,
                importAlias,
              };
            }
          });
        }
      }
      /* React lazy loading import
       * e.g. const foo = React.lazy(() => import('./module'));
       */
      importPath = this.parseNestedDynamicImports(declarator);
      if (importPath.length && isIdentifier(declarator.id)) {
        importName = declarator.id.name;
        output[importAlias || importName] = {
          importPath,
          importName,
          importAlias,
        };
      }
    });
    return output;
  }

  // TODO: Explicit parsing of nested Import CallExpression in ArrowFunctionExpression body
  // TODO: Support AwaitExpression, Promise.resolve(), then() chains for dynamic imports
  private parseNestedDynamicImports(ast: ASTNode): string {
    const recurse = (node: ASTNode): string | void => {
      if (isCallExpression(node) && isImport(node.callee) && isStringLiteral(node.arguments[0])) {
        return node.arguments[0].value;
      }
      // eslint-disable-next-line no-restricted-syntax
      for (const key in node) {
        // @ts-expect-error
        if (node[key] && typeof node[key] === 'object') {
          // @ts-expect-error
          const importPath = recurse(node[key]);
          if (importPath) return importPath;
        }
      }
    };
    return recurse(ast) || '';
  }

  private getChildNodes(
    imports: Record<string, ImportData>,
    astToken: Token,
    props: Record<string, boolean>,
    parent: Tree,
    children: Record<string, Tree>
  ): Record<string, Tree> {
    if (children[astToken.value]) {
      children[astToken.value].count += 1;
      children[astToken.value].props = { ...children[astToken.value].props, ...props };
    } else {
      const moduleIdentifier = imports[astToken.value].importPath;
      const name = imports[astToken.value].importName;
      const filePath = path.resolve(path.dirname(parent.filePath), moduleIdentifier);

      // Add tree node to childNodes if one does not exist
      children[astToken.value] = {
        id: getNonce(),
        name,
        fileName: path.basename(filePath),
        filePath,
        importPath: moduleIdentifier,
        isExpanded: false,
        depth: parent.depth + 1,
        isThirdParty: false,
        isReactRouter: false,
        hasReduxConnect: false,
        count: 1,
        props,
        children: [],
        parentList: [parent.filePath].concat(parent.parentList),
        error: '',
      };
    }
    return children;
  }

  // Finds JSX React Components in current file
  private getJSXChildren(
    astTokens: Array<Token>,
    imports: Record<string, ImportData>,
    parentNode: Tree
  ): Array<Tree> {
    let childNodes: Record<string, Tree> = {};
    let props: Record<string, boolean> = {};
    let token: Token;

    for (let i = 0; i < astTokens.length; i++) {
      // Case for finding JSX tags eg <App .../>
      if (
        astTokens[i].type.label === 'jsxTagStart' &&
        astTokens[i + 1].type.label === 'jsxName' &&
        imports[astTokens[i + 1].value]
      ) {
        token = astTokens[i + 1];
        props = this.getJSXProps(astTokens, i + 2);
        childNodes = this.getChildNodes(imports, token, props, parentNode, childNodes);

        // Case for finding components passed in as props e.g. <Route component={App} />
      } else if (
        astTokens[i].type.label === 'jsxName' &&
        (astTokens[i].value === 'component' || astTokens[i].value === 'children') &&
        imports[astTokens[i + 3].value]
      ) {
        token = astTokens[i + 3];
        childNodes = this.getChildNodes(imports, token, props, parentNode, childNodes);
      }
    }

    return Object.values(childNodes);
  }

  // Extracts prop names from a JSX element
  private getJSXProps(astTokens: Array<Token>, j: number): Record<string, boolean> {
    const props: Record<string, boolean> = {};
    while (astTokens[j].type.label !== 'jsxTagEnd') {
      if (astTokens[j].type.label === 'jsxName' && astTokens[j + 1].value === '=') {
        props[astTokens[j].value] = true;
      }
      j += 1;
    }
    return props;
  }

  // Checks if current Node is connected to React-Redux Store
  private checkForRedux(astTokens: Array<Token>, imports: Record<string, ImportData>): boolean {
    // Check that react-redux is imported in this file (and we have a connect method or otherwise)
    let reduxImported = false;
    let connectAlias;
    Object.keys(imports).forEach((key) => {
      if (imports[key].importPath === 'react-redux' && imports[key].importName === 'connect') {
        reduxImported = true;
        connectAlias = key;
      }
    });

    if (!reduxImported) {
      return false;
    }

    // Check that connect method is invoked and exported in the file
    for (let i = 0; i < astTokens.length; i += 1) {
      if (
        astTokens[i].type.label === 'export' &&
        astTokens[i + 1].type.label === 'default' &&
        astTokens[i + 2].value === connectAlias
      ) {
        return true;
      }
    }
    return false;
  }
}
