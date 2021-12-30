import * as path from 'path';
import * as React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload } from '@fortawesome/free-solid-svg-icons';

import { SaplingSettings } from '../../types/SaplingSettings';

// Control settings for e.g. webpack / tsconfig aliasing in React application
const Settings = ({ saplingSettings }: { saplingSettings: SaplingSettings }) => {
  const settingsMessage = (settingName: string, value: string | boolean) => {
    if (settingName) {
      tsvscode.postMessage({
        type: 'settings',
        value: [settingName, value],
      });
    }
  };

  return (
    <div id="settings">
      <label htmlFor="alias-checkbox">Use webpack/tsconfig aliasing</label>
      <input
        type="checkbox"
        id="alias-checkbox"
        onChange={() => settingsMessage('useAlias', !saplingSettings.useAlias)}
        checked={saplingSettings.useAlias}
      />

      <div className="settings-control">
        <label htmlFor="application-root">Select root directory for application:</label>
        <div className="selector">
          <button
            type="submit"
            id="application-root"
            className="inputfile"
            onClick={() => settingsMessage('appRoot', 'selectFile')}
            disabled={!saplingSettings.useAlias}
          >
            <FontAwesomeIcon icon={faDownload} />
            <strong>
              {saplingSettings.appRoot
                ? ` ${path.basename(saplingSettings.appRoot)}`
                : ' Choose root App folder...'}
            </strong>
          </button>
        </div>
      </div>

      <div className="settings-control">
        <label htmlFor="webpack-config">Select webpack config file:</label>
        <div className="selector">
          <button
            type="submit"
            id="webpack-config"
            className="inputfile"
            onClick={() => settingsMessage('webpackConfig', 'setFile')}
            disabled={!saplingSettings.useAlias}
          >
            <FontAwesomeIcon icon={faDownload} />
            <strong>
              {saplingSettings.webpackConfig
                ? ` ${path.basename(saplingSettings.webpackConfig)}`
                : ' Choose webpack config file...'}
            </strong>
          </button>
        </div>
      </div>

      <div className="settings-control">
        <label htmlFor="tsconfig">Select tsconfig file:</label>
        <div className="selector">
          <button
            type="submit"
            id="tsconfig"
            className="inputfile"
            onClick={() => settingsMessage('tsConfig', 'setFile')}
            disabled={!saplingSettings.useAlias}
          >
            <FontAwesomeIcon icon={faDownload} />
            <strong>
              {saplingSettings.tsConfig
                ? ` ${path.basename(saplingSettings.tsConfig)}`
                : ' Choose tsconfig file...'}
            </strong>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
