/* global require, module */
/* jshint esversion: 6 */
/* Magic Mirror
 * Node Helper: MMM-NetworkScanner
 *
 * By Ian Perrin http://ianperrin.com
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const ping = require("ping");
const sudo = require("sudo");

module.exports = NodeHelper.create({

  start: function() {
    this.log(`Starting module: ${this.name}`);
  },

  // Override socketNotificationReceived method.
  socketNotificationReceived: function(notification, payload) {
    this.log(`${this.name} received ${notification}`);

    switch (notification) {
      case 'CONFIG':
        this.config = payload;
        return true;
      case 'SCAN_NETWORK':
        this.scanNetworkMAC();
        this.scanNetworkIP();
        return true;
    }
  },

  scanNetworkMAC: function() {
    this.log(`${this.name} is performing arp-scan`);

    // Target hosts/network supplied in config or entire localnet
    const arpHosts = (this.config.network || '-l');
    const arp = sudo(['arp-scan', '-q', arpHosts]);
    const discoveredMacAddresses = [];
    const discoveredDevices = [];

    let buffer = '';
    let errstream = '';

    arp.stdout.on('data', data => { buffer += data; });
    arp.stderr.on('data', data => { errstream += data; });
    arp.on('error', err => { errstream += err; });

    arp.on('close', code => {
      if (code !== 0) {
          this.log(
            `${this.name} received an error running arp-scan: ${code}:`,
             errstream
          );
        return;
      }

      // Parse the ARP-SCAN table response
      const [ , , ...rows] = buffer.split('\n');
      rows.forEach(row => {
        const cells = row.split('\t').filter(String);
        const [ , macAddress = ''] = cells;
        const upperMac = macAddress.toUpperCase();

        if (discoveredMacAddresses.indexOf(upperMac) < 0) {
          discoveredMacAddresses.push(upperMac);
          const device = this.findDeviceByMacAddress(upperMac);
          if (device) {
            device.online = true;
            discoveredDevices.push(device);
          }
        }
      });

      this.log(`${this.name} arp scan addresses:`, discoveredMacAddresses);
      this.log(`${this.name} arp scan devices:`, discoveredDevices);

      this.sendSocketNotification("MAC_ADDRESSES", discoveredDevices);
    });

  },

  scanNetworkIP: function() {
    if (!this.config.devices) {
      return;
    }

    this.log(`${this.name} is scanning for ip addresses`, this.config.devices);

    const discoveredDevices = [];

    this.config.devices.forEach(device => {
      this.log("Checking Device...");

      if ("ipAddress" in device) {
        this.log("pinging for ", device);

        ping.sys.probe(device.ipAddress, isAlive => {
          device.online = isAlive;

          if (isAlive) { discoveredDevices.push(device); }

          this.sendSocketNotification("IP_ADDRESS", device);
        });
      }
    });

    this.log(`${this.name} ping results: `, discoveredDevices);
  },

  findDeviceByMacAddress: function (macAddress) {
    // Find first device with matching macAddress
    this.config.devices.forEach(device => {
      const { macAddress:thisMacAddress = '' } = device;
      if (thisMacAddress.toUpperCase() === macAddress.toUpperCase()) {
        this.log(`${this.name} found device by MAC Address`, device);
        return device;
      }
    });

    // Return macAddress (if showing unknown) or null
    if (this.config.showUnknown) {
      return {
        macAddress: macAddress,
        name: macAddress,
        icon: "question",
        type: "Unknown"
      };
    }

    return null;
  },

  log: function(message, object) {
    // Log if config is missing or in debug mode
    if (!this.config || this.config.debug) {
      if (object) { console.log(message, object); }
      else { console.log(message); }
    }
  },

});
