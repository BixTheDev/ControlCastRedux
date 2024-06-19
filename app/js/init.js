'use strict';
/* eslint no-inline-comments: 0 */
/* eslint no-unused-vars: 0 */
/* eslint no-undef: 0 */
/* eslint no-console: 0 */
/* eslint new-cap: 0 */
/* eslint prefer-const: 0 */

const Config = require('electron-config');
const remote = require('electron').remote;
const Menu = remote.Menu;
const dialog = remote.dialog;
const Tray = remote.Tray;
const clipboard = require('electron').clipboard;
const path = require('path');
const ipc = require('electron').ipcRenderer;
const midi = require('midi');
const usbDetect = require('usb-detection');
const launchpadder = require('launchpadder').Launchpad;
const color = require('launchpadder').Color;
const _ = require('underscore');
const noty = require('noty');
const keycode = require('keycode');
const fs = require('fs');
const request = require('request');
const moment = require('moment');
const fetch = require('superagent');

window.$ = window.jQuery = require('jquery');
require('./js/jquery/jquery-ui.min.js');
require('./js/jquery/alphanum.min.js');


let launchpad; // Our launchpadder instance
let usbConnected; // Bool for Launchpad USB state
let reconnectTimer; // Reconnection timer
let lastKey = [0, 0]; // Stores the last key pressed
let notyUpdates = false;
let clrRunning = false;
let css_editor;

const keyboard = [];
let tracks = {}; // Holds all the audio tracks in memory to be played
let images = {};

const config = new Config(); // Load Config
let tempKeys = {}; // Temp key settings before saving

$(document).ready(() => { // On DOM ready
  for (let c = 0; c < 8; c++) { // Creates the top row key divs
    const newDiv = document.createElement('div');
    newDiv.setAttribute('class', 'key round OFF');
    newDiv.setAttribute('data-pos', `${c},8`);
    newDiv.setAttribute('data-color', 'OFF');
    $('.launchpad .keys_top').append(newDiv);
  }
  for (let c = 0; c < 8; c++) {
    for (let r = 0; r < 8; r++) { // Creates the main key grid divs
      const newDiv = document.createElement('div');
      newDiv.setAttribute('class', 'key square OFF');
      newDiv.setAttribute('data-pos', `${r},${c}`);
      newDiv.setAttribute('data-color', 'OFF');
      $('.launchpad .keys_main').append(newDiv);
    }
  }
  for (let r = 0; r < 8; r++) { // Creates the side key divs
    const newDiv = document.createElement('div');
    newDiv.setAttribute('class', 'key round OFF');
    newDiv.setAttribute('data-pos', `8,${r}`);
    newDiv.setAttribute('data-color', 'OFF');
    $('.launchpad .keys_side').append(newDiv);
  }

  if (config.get('app.clr.enabled')) {
    $('.clr_options').show();
  } else {
    $('#flush_clr').hide();
  }
  if (!clrRunning) startCLR();

  readyLaunchpad();
  readyOptions();
  isMidiConnected(); // Set midi_connected on load

  $('body').fadeIn(200);

  setAllLights(); // Set all gui and midi lights to released state
  loadTracks(); // Load audio tracks into memory to be played immediately on demand

  $('#update_available').click(() => {
    ipc.send('quit_and_install'); // Force quit and update
  });
});

function connectToLaunchpad() { // Attempt to connect to the Launchpad
  const midiIn = new midi.input(); // Create new Midi input
  const midiOut = new midi.output(); // Create new Midi output
  const midiInCount = midiIn.getPortCount(); // Gets the number of Midi input ports connected
  const midiOutCount = midiOut.getPortCount(); // Gets the number of Midi output ports connected
  if (midiInCount <= 0 || midiOutCount <= 0) {
    console.log('No Midi devices found. Have you plugged in the Launchpad Device yet?');
    return;
  }
  let midiInPort = null;
  let midiOutPort = null;
  for (let i = 0; i < midiInCount; i++) { // Loop through Midi input ports
    if (midiIn.getPortName(i).toLowerCase().includes('launchpad')) {
      midiInPort = i; // Save index of Launchpad input port if found
    }
  }
  for (let i = 0; i < midiOutCount; i++) { // Loop through Midi output ports
    if (midiOut.getPortName(i).toLowerCase().includes('launchpad')) {
      midiOutPort = i; // Save index of Launchpad output port if found
    }
  }
  if (midiInPort === null || midiOutPort === null) {
    console.log('Launchpad Device not found. Is it unplugged?');
    return;
  }

  launchpad = new launchpadder(midiInPort, midiOutPort); // Connect to launchpad
  if (launchpad) {
    console.log(`'${midiIn.getPortName(midiInPort)}' connection successful`);
    isMidiConnected(); // Set midi_connected

    launchpad.on('press', button => { // Create the midi button press handler
      keyEvent('midi', [button.x, button.y], 'press'); // Pass to key event handler
    });

    launchpad.on('release', button => { // Create midi button release handler
      keyEvent('midi', [button.x, button.y], 'release'); // Pass to key event handler
    });
  } else {
    console.log('Unable to connect to the Launchpad Device');
  }
}

usbDetect.on('add', device => {
  if (device.deviceName.toLowerCase().includes('launchpad')) { // Launchpad USB was inserted
    console.log(`'${device.deviceName}' USB detected. Connecting in 4 seconds`);
    if (!usbConnected) { // This stops the random occurrence of the add event firing twice rapidly
      usbConnected = true;
      reconnectTimer = setTimeout(() => {
        connectToLaunchpad();
        setAllLights();
      }, 4000); // Wait 4 seconds for the Launchpad init to finish before attempting to connect.
    }
  }
});

usbDetect.on('remove', device => {
  if (device.deviceName.toLowerCase().includes('launchpad')) { // Launchpad USB was removed
    console.log(`'${device.deviceName}' USB disconnected`);
    if (reconnectTimer) clearTimeout(reconnectTimer); // Stop reconnect timer if it was started
    usbConnected = false;
    launchpad = null;
    isMidiConnected(); // Set midi_connected
  }
});

connectToLaunchpad(); // Connect on startup

function isMidiConnected() {
  if (launchpad) { // Set the midi_connected color based on if launchpad is connected
    $('.midi_connected').addClass('connected');
  } else {
    $('.midi_connected').removeClass('connected');
  }
}

function loadTracks() { // Load track data to array
  console.log('Loading Audio Tracks');
  tracks = {};
  const keys = config.get('keys');
  for (const key in keys) { // Loop through keys
    if (keys.hasOwnProperty(key)) {
      const audio = keys[key].audio; // Get key audio settings
      if (audio && audio.path) {
        const audioPath = path.normalize(audio.path);
        tracks[key] = new Audio(audioPath);
        tracks[key].volume = audio.volume / 100;
      }
    }
  }
}


function getKeyConfig(key) {
  if (Array.isArray(key)) key = key.join(',');
  return tempKeys[key] || config.get(`keys.${key}`) || defaultKeyConfig();
}

function defaultKeyConfig() { // Sets the default key config
  return {
    description: '',
    color: {
      press: 'OFF',
      release: 'OFF',
    },
    hotkey: {
      type: 'send',
      string: '',
    },
    audio: {
      path: '',
      type: 'normal',
      volume: '50',
    },
    api: {
      path: '',
    },
    clr: {
      path: '',
      pos: '',
      animate: {
        open: {
          delay: '0.0',
          type: 'fadeIn',
          duration: '1.0',
        },
        close: {
          delay: '2.0',
          type: 'fadeOut',
          duration: '1.0',
        },
      },
      css: '.img {\n  width: 50%;\n}',
    },
  };
}
