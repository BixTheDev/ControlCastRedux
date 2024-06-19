'use strict';
/* eslint no-inline-comments: 0 */

const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipc = electron.ipcMain;
const autoUpdater = electron.autoUpdater;

const Config = require('electron-store');
const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;
const robot = require('robotjs');
const logger = require('./logger')();

const simpleflake = require('simpleflakes');


// Squirrel Auto Update Handlers


const target = path.basename(process.execPath);
function runCommand(args, callback) {
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  logger.debug('Spawning `%s` with args `%s`', updateExe, args);
  spawn(updateExe, args, { detached: true }).on('close', callback);
}

function handleStartupEvent() {
  if (process.platform !== 'win32') {
    return false;
  }
  const squirrelCommand = process.argv[1];
  switch (squirrelCommand) {
    case '--squirrel-install':
    case '--squirrel-updated':
      runCommand([`--createShortcut=${target}`, '--shortcut-locations=Desktop,StartMenu'], () => {
        app.quit();
      });
      return true;
    case '--squirrel-uninstall':
      runCommand([`--removeShortcut=${target}`, '--shortcut-locations=Desktop,StartMenu'], () => {
        app.quit();
      });
      return true;
    case '--squirrel-obsolete':
      app.quit();
      return true;
    default:
      return false;
  }
}

if (handleStartupEvent()) {
  return;
}


// Force Single Instance


const shouldQuit = app.makeSingleInstance(() => {
  // Restore and focus window if instance exists on load
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Application is already running
if (shouldQuit) {
  app.quit();
  return;
}


// Application Init


let mainWindow = null; // Main application window
let portWindow = null; // Config load error window
let forceQuit = null; // Bool to force quit app from tray

app.setAppUserModelId('com.squirrel.ControlCast.ControlCast');
app.setPath('userData', path.join(process.env.APPDATA, 'ControlCast'));

global.app_version = require('../package.json').version; // Store app version for in app displays
global.release_url = require('../package.json').releaseUrl; // Store releaseUrl for update queries

robot.setKeyboardDelay(50); // Set delay for each keypress for OBS

const configVersion = 6;
const config = new Config({
  defaults: {
    app: {
      version: configVersion,
      id: simpleflake.simpleflake().toString(),
      pos: {
        x: null,
        y: null,
      },
      close_to_tray: false,
      auto_start: false,
      start_minimized: false,
      clr: {
        enabled: false,
        port: 3000,
      },
    },
    keys: {},
  },
});

const oldConfigPath = path.join(process.env.LOCALAPPDATA, 'ControlCast/config.json');

updateOldConfig();
fs.exists(oldConfigPath, exists => {
  if (exists) {
    fs.unlink(oldConfigPath, err => {
      if (err) logger.error('Error removing old config file', err);
    });
  }
});
const exec = require('child_process').exec;
const logPath = path.join(process.env.LOCALAPPDATA, 'ControlCast/logs');
if (fs.existsSync(logPath)) {
  exec(`rd /s /q "${logPath}"`, err => {
    if (err) {
      logger.debug('Windows 1st error removing dir, trying a second time...');
      // Sometimes this has to ran twice to succeed.
      exec(`rd /s /q "${logPath}"`, err2 => {
        if (err2) {
          logger.debug('Windows 2nd error removing dir', err2);
        }
      });
    }
  });
}
updateNewConfig();

app.on('window-all-closed', () => { // Quit when all windows are closed.
  if (process.platform !== 'darwin') app.quit();
});

app.on('ready', () => { // Application has finished loading
  createMainWindow(); // Show Main Window
});


// Main Application Window


function createMainWindow() { // Loads main application window
  mainWindow = new BrowserWindow({ // Main window options
    x: config.get('app.pos.x'),
    y: config.get('app.pos.y'),
    width: 900,
    height: 780,
    resizable: false,
    icon: path.join(__dirname, 'images/icon.ico'),
    title: `ControlCast - ${global.app_version}`,
    show: false,
  });

  mainWindow.on('closed', () => { // Destroy window object on close
    mainWindow = null;
  });

  mainWindow.on('close', (e) => { // App is about to close
    if (config.get('app.close_to_tray') && !forceQuit) { // Minimize on close if Close To Tray and not force quit
      mainWindow.setSkipTaskbar(true); // Hide Taskbar Icon
      mainWindow.minimize(); // Minimize main window
      e.preventDefault(); // Cancel close process
      return;
    }
    if (mainWindow) mainWindow.webContents.send('all_dark'); // Tell the launchpad to turn off all lights on close
    const pos = mainWindow.getPosition(); // Save last position of the window for next time the app is run
    // Only save if position changed
    if (config.get('app.pos.x') !== pos[0] || config.get('app.pos.y') !== pos[1]) {
      config.set('app.pos', { x: pos[0], y: pos[1] });
    }
  });

  mainWindow.setMenu(null); // Disable the default app menu
  mainWindow.loadURL(path.join('file://', __dirname, '/index.html')); // Display the main window html

  mainWindow.on('ready-to-show', () => {
    if (config.get('app.start_minimized')) {
      if (config.get('app.close_to_tray')) mainWindow.setSkipTaskbar(true);
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });
}


// Port Window


function createPortWindow() { // Window to tell us what port the application is running on
  const pos = mainWindow.getPosition(); // Get main window position
  const size = mainWindow.getSize(); // Get main window size
  const x = Math.floor(((size[0] - 320) / 2) + pos[0]); // Determine x pos to center port window
  const y = Math.floor(((size[1] - 180) / 2) + pos[1]); // Determine y pos to center port window

  portWindow = new BrowserWindow({
    x,
    y,
    width: 320,
    height: 180,
    resizable: false,
    icon: path.join(__dirname, 'images/icon.ico'),
  });

  portWindow.on('closed', () => { // Destroy window object on close
    portWindow = null;
  });

  portWindow.setMenu(null); // Disable the default menu
  portWindow.loadURL(path.join('file://', __dirname, '/port.html')); // Display the port window html
}


// IPC Messages


ipc.on('windows_auto_start', (e, enabled) => {
  config.set('app.auto_start', enabled);
  if (enabled) {
    runCommand([`--createShortcut=${target}`, '--shortcut-locations=Startup'], () => {
      // Do Nothing
    });
  } else {
    runCommand([`--removeShortcut=${target}`, '--shortcut-locations=Startup'], () => {
      // Do Nothing
    });
  }
});

ipc.on('force_quit', () => {
  forceQuit = true; // Quit selected from tray menu, force close the app
  app.quit();
});

ipc.on('quit_and_install', () => {
  forceQuit = true;
  autoUpdater.quitAndInstall();
});

ipc.on('robot_key', (e, data) => {
  try {
    robot.keyToggle(data.key, data.action);
  } catch (err) {
    logger.error(`robot error, key: ${data.key}`, err);
  }
});

ipc.on('change_port', () => {
  createPortWindow();
});

ipc.on('set_port', (e, data) => {
  if (config.get('app.clr.port') === data) return; // Only save and reset if changed
  config.set('app.clr.port', data); // Set option and save
  if (mainWindow) mainWindow.webContents.send('port_changed'); // Restarts the CLR browser on new port
});


// Config / Settings Changes


function updateOldConfig() {
  if (!fs.existsSync(oldConfigPath)) return;
  let oldConfig;
  try {
    oldConfig = require(oldConfigPath);
  } catch (e) {
    logger.error('Error loading old config file to transfer', e);
    return;
  }
  while (oldConfig.app.version < 5) {
    switch (oldConfig.app.version) {
      case 2:
        oldConfig.app.id = simpleflake.simpleflake().toString();
        oldConfig.app.version = 3;
        break;
      case 3:
        for (const key in oldConfig.keys) {
          if (oldConfig.keys.hasOwnProperty(key)) {
            oldConfig.keys[key].hotkey.string = oldConfig.keys[key].hotkey.string.replace('CTRL', 'L-CTRL')
              .replace('SHIFT', 'L-SHIFT')
              .replace('ALT', 'L-ALT');
          }
        }
        oldConfig.app.version = 4;
        break;
      case 4:
        oldConfig.app.start_minimized = false;
        oldConfig.app.version = 5;
        break;
      default:
      // Do Nothing
    }
  }
  config.set(oldConfig);
}

function updateNewConfig() {
  while (config.get('app.version') < configVersion) {
    const keys = config.get('keys');
    switch (config.get('app.version')) {
      case 5:
        for (const key in keys) {
          if (keys.hasOwnProperty(key)) {
            keys[key].api = {
              path: '',
            };
          }
        }
        config.set('keys', keys);
        config.set('app.version', 6);
        break;
      default:
      // Do Nothing
    }
  }
}
