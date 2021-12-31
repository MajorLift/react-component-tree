import * as path from 'path';
import * as fs from 'fs';
import { create as ResolverCreator } from 'enhanced-resolve';
import { Configuration as WebpackOptions } from 'webpack';
import { CompilerOptions, CompilerOptionsValue } from 'typescript';
// Sapling Options Object Type:
export class SaplingSettings {
  [key: string]: unknown;
  useAlias: boolean;
  appRoot: string;
  webpackConfig: string;
  tsConfig: string;
  aliases: string[];
  wpResolver?: (appRoot: string, importPath: string) => string | false;

  constructor(input?: Partial<SaplingSettings>) {
    this.useAlias = input?.useAlias || false;
    this.appRoot = input?.appRoot || '';
    this.webpackConfig = input?.webpackConfig || '';
    this.tsConfig = input?.tsConfig || '';
    this.aliases = input?.aliases || [];
    this.wpResolver = input?.wpResolver;

    if (this.webpackConfig) this.createWpResolver();
    this.updateAliases();
  }

  // Update parser settings when changed in webview
  public updateSettings(setting: string, value: boolean | string): void {
    this[setting] = value;
    // If settings include webpack Config, try to create resolver
    if (setting === 'webpackConfig') {
      this.createWpResolver();
    }
    this.updateAliases();
  }

  // Returns true if current settings are valid for parsing otherwise false
  public validateSettings(): boolean {
    return !this.useAlias || (this.useAlias !== undefined && this.appRoot !== undefined);
  }

  // Method to create enhanced-resolve resolver for webpack aliases
  public createWpResolver(): void {
    // Try to open provided webpack config file:
    let webpackObj: WebpackOptions;
    try {
      webpackObj = JSON.parse(
        fs.readFileSync(path.resolve(this.webpackConfig), 'utf-8')
      ) as WebpackOptions;
      // Create new resolver to handle webpack aliased imports:
      this.wpResolver = ResolverCreator.sync({
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        ...webpackObj.resolve,
      });
    } catch (err) {
      console.log('Error while trying to load webpack config: ', err);
      this.webpackConfig = '';
      this.wpResolver = undefined;
    }
  }

  // Method that extracts all aliases from tsconfig and webpack config files for parsing
  public updateAliases(): void {
    const aliases: string[] = [];
    if (this.tsConfig) {
      // Try to open tsConfig file, if error then alert user in webview:
      try {
        let tsConfigJSONString = fs.readFileSync(path.resolve(this.tsConfig), 'utf-8');
        // Strip any comments from the JSON before parsing:
        tsConfigJSONString = tsConfigJSONString.replace(
          /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
          (m, g) => (g ? '' : m)
        );
        const tsConfig = JSON.parse(tsConfigJSONString) as {
          compilerOptions: Record<keyof CompilerOptions, CompilerOptionsValue>;
        };

        // If tsConfig contains path aliases, add aliases to parser aliases
        if (tsConfig.compilerOptions && tsConfig.compilerOptions.paths) {
          Object.keys(tsConfig.compilerOptions.paths).forEach((key) => {
            // Remove asterix from end of alias if present
            key = key[key.length - 1] === '*' ? key.slice(0, key.length - 1) : key;
            if (key) {
              aliases.push(key);
            }
          });
        }
      } catch (err) {
        this.tsConfig = '';
      }
    }

    // Extract any webpack aliases for parsing
    if (this.webpackConfig && this.wpResolver) {
      try {
        const wpObj = JSON.parse(fs.readFileSync(this.webpackConfig, 'utf-8')) as WebpackOptions;
        if (wpObj.resolve && wpObj.resolve.alias) {
          Object.keys(wpObj.resolve.alias).forEach((key) => {
            key = key[key.length - 1] === '$' ? key.slice(0, key.length - 1) : key;
            if (key) {
              aliases.push(key);
            }
          });
        }
      } catch (err) {
        this.webpackConfig = '';
      }
    }
    this.aliases = aliases;
  }
}
