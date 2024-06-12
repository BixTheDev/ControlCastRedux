'use strict';
/* eslint no-inline-comments: 0 */
/* eslint no-unused-vars: 0 */
/* eslint no-undef: 0 */
/* eslint no-console: 0 */

const titleMenu = Menu.buildFromTemplate([
    {
        label: 'View',
        submenu: [
            {
                label: 'Reload',
                accelerator: 'CmdOrCtrl+R',
                click: (item, focusedWindow) => {
                    if (focusedWindow) {
                        if (tray) tray.destroy();
                        focusedWindow.reload(); // Reload the main window and it's elements
                    }
                },
      },
            {
                label: 'Toggle Dev Tools',
                click: (item, focusedWindow) => {
                    if (focusedWindow) focusedWindow.toggleDevTools();
                },
      },
    ],
  },
    {
        label: 'Settings',
        submenu: [
            {
                label: 'Close to Tray',
                type: 'checkbox',
                click: (e) => config.set('app.close_to_tray', e.checked),
      },
            {
                label: 'Start with Windows',
                type: 'checkbox',
                click: (e) => ipc.send('windows_auto_start', e.checked),
      },
            {
                label: 'Start Minimized',
                type: 'checkbox',
                click: (e) => config.set('app.start_minimized', e.checked),
      },
            {
                label: 'CLR Browser',
                submenu: [
                    {
                        label: 'Enabled',
                        type: 'checkbox',
                        click: (e) => {
                            config.set('app.clr.enabled', e.checked);
                            titleMenu.items[1].submenu.items[3].submenu.items[1].enabled = e.checked;
                            titleMenu.items[1].submenu.items[3].submenu.items[2].enabled = e.checked;
                            if (e.checked) {
                                $('.clr_options').show();
                                $('#flush_clr').show();
                                startCLR();
                                clrNoty();
                            } else {
                                $('.clr_options').hide();
                                $('#flush_clr').hide();
                                stopCLR();
                            }
                        },
          },
                    {
                        label: 'Change Port',
                        click: () => ipc.send('change_port'),
          },
                    {
                        label: 'Open Browser',
                        click: () => require('electron').shell.openExternal(`http://localhost:${config.get('app.clr.port')}`),
          },
        ],
      },
    ],
  },
    {
        label: 'Config',
        submenu: [
            {
                label: 'Import Config',
                accelerator: 'Ctrl+Shift+I',
                click: (item, focusedWindow) => {
                    function openDirectoryDialog() {
                        return new Promise((resolve, reject) => {
                            dialog.showOpenDialog({
                                properties: ['openFile']
                            }, (filePaths) => {
                                if (filePaths) {
                                    resolve(filePaths);
                                } else {
                                    reject('No directory selected');
                                }
                            });
                        });
                    }

                    // Usage
                    openDirectoryDialog()
                        .then((filePaths) => {
                            copyConfigFile(filePaths[0].toString());
                            if (focusedWindow) {
                                if (tray) tray.destroy();
                                focusedWindow.reload(); // Reload the main window and it's elements
                            }
                        })
                        .catch((error) => {
                            console.error(error);
                        });

                },
      },
            {
                label: 'Export Config',
                accelerator: 'Ctrl+Shift+E',
                click: (item, mainWindow) => {
                    function openDirectoryDialog() {
                        return new Promise((resolve, reject) => {
                            dialog.showOpenDialog({
                                properties: ['openDirectory']
                            }, (filePaths) => {
                                if (filePaths) {
                                    resolve(filePaths);
                                } else {
                                    reject('No directory selected');
                                }
                            });
                        });
                    }

                    // Usage
                    openDirectoryDialog()
                        .then((filePaths) => {
                            copyConfigToDownloads(filePaths[0].toString());
                        })
                        .catch((error) => {
                            console.error(error);
                        });
                },
      },
            {
                label: 'Reset Config',
                click: (item, focusedWindow) => {
                    config.set('keys', {});
                    if (focusedWindow) {
                        if (tray) tray.destroy();
                        focusedWindow.reload(); // Reload the main window and it's elements
                    }
                }
        },
],
}, {
        label: 'Help',
        submenu: [
            {
                label: 'Check for Updates',
                click: () => {
                    notyUpdates = true;
                    checkForUpdates();
                },
      },
            {
                label: 'View on GitHub', // Open client browser to Github
                click: () => require('electron').shell.openExternal('https://github.com/dbkynd/controlcast'),
      },
            {
                label: 'About',
                click: () => {
                    dialog.showMessageBox({ // Show message box with detail about the application
                        type: 'info',
                        buttons: ['ok'],
                        title: 'About ControlCast',
                        message: `'ControlCast' by DBKynd\nVersion: ${remote.getGlobal('app_version')}` +
                            `\ndb@dbkynd.com\n©${moment().format('YYYY')}\n\nArtwork and Beta Testing by AnneMunition`,
                    });
                },
      },
    ],
}, ]);

Menu.setApplicationMenu(titleMenu); // Set title menu

// Set options from config
titleMenu.items[1].submenu.items[0].checked = config.get('app.close_to_tray');
titleMenu.items[1].submenu.items[1].checked = config.get('app.auto_start');
titleMenu.items[1].submenu.items[2].checked = config.get('app.start_minimized');
titleMenu.items[1].submenu.items[3].submenu.items[0].checked = config.get('app.clr.enabled');
titleMenu.items[1].submenu.items[3].submenu.items[1].enabled = config.get('app.clr.enabled');
titleMenu.items[1].submenu.items[3].submenu.items[2].enabled = config.get('app.clr.enabled');

function copyConfigFile(importConfigData) {
    try {
        // Read the content of the config file
        const newConfigFileContent = fs.readFileSync(importConfigData, 'utf8');

        // Write the content to the destination file
        fs.writeFileSync(config.path, newConfigFileContent);

        console.log(`Config file copied from ${sourceFilePath} to ${destinationFilePath} successfully.`);
    } catch (err) {
        console.error('Error copying config file:', err);
    }
}



function copyConfigToDownloads(exportPath) {
    // Specify the path of the configuration file
    const configFilePath = path.join(config.path);
    const downloadsPath = path.join(require('os').homedir(), 'Downloads');

    const downloadsConfigFilePath = path.join(exportPath, 'config.json');

    try {
        // Check if the config file exists
        if (fs.existsSync(configFilePath)) {
            // Create read and write streams
            const readStream = fs.createReadStream(configFilePath);
            const writeStream = fs.createWriteStream(downloadsConfigFilePath);

            // Pipe the read stream to the write stream
            readStream.pipe(writeStream);

            // Log success message when copy is done
            writeStream.on('finish', () => {
                console.log('Config file copied to downloads folder successfully.');
            });
        } else {
            console.error('Config file does not exist.');
        }
    } catch (err) {
        console.error('Error copying config file to downloads folder:', err);
    }
}

function clrNoty() {
    const blanket = $('.blanket');
    $(blanket).fadeIn(200); // Darken the body
    const address = `http://localhost:${config.get('app.clr.port') || 3000}`;
    noty({
        text: `<b>${address}</b>`,
        animation: {
            open: 'animated flipInX', // Animate.css class names
            close: 'animated flipOutX', // Animate.css class names
        },
        layout: 'center',
        type: 'alert',
        timeout: false,
        closeWith: ['click', 'button'],
        callback: {
            onClose: () => $(blanket).fadeOut(1000),
        },
        buttons: [
            {
                addClass: 'btn btn-primary',
                text: 'Copy to Clipboard',
                onClick: ($noty) => {
                    $noty.close();
                    clipboard.writeText(address);
                },
      },
            {
                addClass: 'btn',
                text: 'Close',
                onClick: ($noty) => $noty.close(),
      },
    ],
    });
}
