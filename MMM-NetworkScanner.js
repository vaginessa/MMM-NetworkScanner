/* global Log, Module, moment, config */
/* Magic Mirror
 * Module: MMM-NetworkScanner
 *
 * By Ian Perrin http://ianperrin.com
 * MIT Licensed.
 */

//var Module, Log, moment, config, Log, moment, document;


Module.register("MMM-NetworkScanner", {

   // Default module config.
  defaults: {
    /* an array of device objects e.g.
     * [{
     *   macAddress: "aa:bb:cc:11:22:33",
     *   name: "DEVICE-NAME",
     *   icon: "FONT-AWESOME-ICON"
     * }]
     */
    devices: [],

    /* show found devices not specified in config */
    showUnknown: true,

    /* show devices in config even when offline */
    showOffline: true,

    /* show when device was lat seen */
    showLastSeen: false,

    /* length a device can be 'alive' since last found */
    keepAlive: 180,

    /* how often the network should be scanned */
    updateInterval: 20,

    /* list of device names to associate w/ notifications */
    residents: [],

    /* command dispatched when a resident returns to the network
     * e.g. {notification: 'TEST', payload: {action: 'occupiedCMD'}}
     */
    occupiedCMD: null,

    /* command dispatched when the network is vacant of residents */
    vacantCMD: null,

    debug: false,
  },

  log: function(str, override=false) {
    if (this.config.debug || override) {
      Log.info(str);
    }
  },

  // Subclass start method.
  start: function () {
    this.log(`Starting module ${this.name}`, true);
    this.log(`${this.name} config:\n${this.config}`);

    // variable for if anyone is home
    this.occupied = true;

    moment.locale(config.language);

    this.validateDevices();

    this.sendSocketNotification('CONFIG', this.config);

    this.scanNetwork();
  },

  // Subclass getStyles method.
  getStyles: function () {
    return ['font-awesome.css'];
  },

  // Subclass getScripts method.
  getScripts: function () {
    return ["moment.js"];
  },

  // Subclass socketNotificationReceived method.
  socketNotificationReceived: function (notification, payload) {
    this.log(`${this.name} received a notification ${notification} ${payload}`);

    var self = this;
    const getKeyedDevices = (devices, key) => devices.reduce(
      (acc, device) => ({ ...acc, [device[key]]: device }),
      {}
    );

    /* p sure this doesn't even do anything ? */
    if (notification === 'IP_ADDRESS') {
      if (payload.hasOwnProperty("ipAddress")) {
        // set last seen
        if (payload.online) {
           payload.lastSeen = moment();
        }
        // Keep alive?
        payload.online = (moment().diff(payload.lastSeen, 'seconds') < this.config.keepAlive);
      }
    }

    if (notification === 'MAC_ADDRESSES') {
      if (this.config.debug) Log.info(this.name + " MAC_ADDRESSES payload: ", payload);

      this.networkDevices = payload;

      // Update device info
      for (var i = 0; i < this.networkDevices.length; i++) {
        var device = this.networkDevices[i];
        // Set last seen
        if (device.online) {
          device.lastSeen = moment();
        }
        // Keep alive?
        device.online = (moment().diff(device.lastSeen, 'seconds') < this.config.keepAlive);
      }

      // Add offline devices from config
      if (this.config.showOffline) {
        for (var d = 0; d < this.config.devices.length; d++) {
          var device = this.config.devices[d];

          for(var n = 0; n < this.networkDevices.length; n++){
            if( device.macAddress && this.networkDevices[n].macAddress && this.networkDevices[n].macAddress.toUpperCase() === device.macAddress.toUpperCase()) {
              n = -1;
              break;
            }
          }

          if (n != -1) {
            device.online = false;
            this.networkDevices.push(device);
          }
        }
      }

      // Sort list by known device names, then unknown device mac addresses
      this.networkDevices.sort(function (a, b) {
        var stringA, stringB;
        stringA = (a.type != "Unknown" ? "_" + a.name + a.macAddress : a.name);
        stringB = (b.type != "Unknown" ? "_" + b.name + b.macAddress : b.name);

        return stringA.localeCompare(stringB);
      });


      // Send notification if user status has changed
      if (this.config.residents.length > 0) {
        var anyoneHome, command;
//        self = this;
        anyoneHome = 0;

        this.networkDevices.forEach(function (device) {
          if (self.config.residents.indexOf(device.name) >= 0) {
            anyoneHome = anyoneHome + device.online;
          }
        });

        if (this.config.debug) Log.info("# people home: ", anyoneHome);
        if (this.config.debug) Log.info("Was occupied? ", this.occupied);

        if (anyoneHome > 0) {
          if (this.occupied === false) {
            if (this.config.debug) Log.info("Someone has come home");
            command = self.config.occupiedCMD;
            this.sendNotification(command.notification, command.payload);
            this.occupied = true;
          }
        } else {
          if (this.occupied === true) {
            if (this.config.debug) Log.info("Everyone has left home");
            command = self.config.vacantCMD;
            this.sendNotification(command.notification, command.payload);
            this.occupied = false;
          }
        }
      }

      this.updateDom();
      return;
    }
  },

  // Override dom generator.
  getDom: function () {
    // var wrapper, deviceList, icon, deviceItem, deviceOnline, self;
    const wrapper = document.createElement("div");
    const deviceList = document.createElement("ul");

    wrapper.classList.add("small");
    deviceList.classList.add("fa-ul");

    // Display a loading message
    if (!this.networkDevices) {
      wrapper.innerHTML = this.translate("LOADING");
      return wrapper;
    }

    this.networkDevices.forEach((device) => {
      if (device) {

        // device list item
        const deviceItem = document.createElement("li");
        const deviceOnline = (device.online ? "bright" : "dimmed");
        deviceItem.classList.add(deviceOnline);

        // Icon
        const icon =  document.createElement("i");
        icon.classList.add("fa-li", "fa", `fa-${device.icon}`);
        deviceItem.appendChild(icon);

        // Name
        deviceItem.innerHTML += device.name;

        // When last seen
        if (this.config.showLastSeen && device.lastSeen) {
           deviceItem.innerHTML +=
             `&nbsp;<small class="dimmed">
               ("${device.lastSeen.fromNow()}")
             </small>`;
        }

        deviceList.appendChild(deviceItem);

      } else {
        this.log(`${this.name} Online, but ignoring: ${device}`);
      }
    });

    if (deviceList.hasChildNodes()) {
      wrapper.appendChild(deviceList);
    } else {
      // Display no devices online message
      wrapper.innerHTML = this.translate("NO DEVICES ONLINE");
    }

    return wrapper;
  },

  validateDevices: function () {
    this.config.devices.forEach(function (device) {
      // Add missing device attributes.
      if (!device.hasOwnProperty("icon")) {
        device.icon = "question";
      }

      if (!device.hasOwnProperty("name")) {
        device.name = device.hasOwnProperty("macAddress")
          ? device.macAddress
          : device.hasOwnProperty("ipAddress")
            ? device.ipAddress
            : "Unknown";
      }
    });
  },

  scanNetwork: function () {
    this.log(`${this.name} is initiating network scan`);

    const interval = this.config.updateInterval * 1000;

    this.sendSocketNotification('SCAN_NETWORK');
    setInterval(
      () => { this.sendSocketNotification('SCAN_NETWORK'); },
      interval
    );

    return;
  },

});

