import { Service, API, Logging } from 'homebridge';
import * as Path from 'path';
import * as fs from 'fs';
import { DateTime } from 'luxon';
import { Cache } from 'file-system-cache';

/* eslint @typescript-eslint/no-var-requires: "off" */
const pkg = require('../package.json');

export const PLATFORM_NAME = 'Nordpool';
export const PLUGIN_NAME = pkg.name;
export const PLATFORM_MANUFACTURER = pkg.author.name;
export const PLATFORM_VERSION = pkg.version;
export const PLATFORM_MODEL = 'Electricity price sensors';
export const PLATFORM_SERIAL_NUMBER = 'UN783GU921Y0';

// main device(s)
export const devices = [
  {
    UniqueId: 'JKGhJH654*87pDE',
    displayName: 'Nordpool',
  },
];

export interface SensorType { [key: string]: Service | null }

export interface NordpoolData {
    day: string;
    hour: number;
    price: number;
  }

export interface Pricing {
    today: NordpoolData[];
    currently: number;
    currentHour: number;
    cheapestHour: number[];
    cheapest4Hours: number[];
    cheapest5Hours: number[];
    cheapest5HoursConsec: number[];
    cheapest5HoursConsec2days: number[];
    cheapest6Hours: number[];
    cheapest7Hours: number[];
    cheapest8Hours: number[];
    cheapest9Hours: number[];
    cheapest10Hours: number[];
    cheapest11Hours: number[];
    cheapest12Hours: number[];
    priciestHour: number[];
    median: number;
    median2days: number;
  }

// eslint-disable-next-line prefer-const
export let pricing: Pricing = {
  today: [],
  currently: 0.0001,
  currentHour: 0,
  cheapestHour: [],
  cheapest4Hours: [],
  cheapest5Hours: [],
  cheapest5HoursConsec: [],
  cheapest5HoursConsec2days: [],
  cheapest6Hours: [],
  cheapest7Hours: [],
  cheapest8Hours: [],
  cheapest9Hours: [],
  cheapest10Hours: [],
  cheapest11Hours: [],
  cheapest12Hours: [],
  priciestHour: [],
  median: 0,
  median2days: 0,
};

export const defaultService: SensorType = {
  currently: null,
  cheapestHour: null,
  cheapest4Hours: null,
  cheapest5Hours: null,
  cheapest5HoursConsec: null,
  cheapest6Hours: null,
  cheapest7Hours: null,
  cheapest8Hours: null,
  cheapest9Hours: null,
  cheapest10Hours: null,
  cheapest11Hours: null,
  cheapest12Hours: null,
  priciestHour: null,
  hourlyTickerSwitch: null,
};

export function defaultPricesCache(api: API, log: Logging) {
  const ns = 'homebridge-nordpool-baltics';
  const nsHash = 'b162cf22c8adb8fa829628b261839cad18dc3994';
  const storagePath = api.user.storagePath();
  const cacheDirectory = Path.join(storagePath, '.cache');

  try {
    // Ensure .cache directory exists
    if (!fs.existsSync(cacheDirectory)) {
      fs.mkdirSync(cacheDirectory, { recursive: true });
      log.debug(`OK: Cache directory created at ${cacheDirectory}`);
    }

    // Check if directory is writable
    fs.accessSync(cacheDirectory, fs.constants.W_OK);
  } catch (error: unknown) {
    if (error instanceof Error) {
      log.warn(`Failed to access or create cache directory at ${cacheDirectory}: ${error.message}`);
    } else {
      log.warn(`Failed to access or create cache directory at ${cacheDirectory}: Unknown error`);
    }
  }

  // Auto-cleanup of old cached files on init
  const files = fs.readdirSync(cacheDirectory);
  const now = Date.now();

  files.filter(file => file.startsWith(`${nsHash}-`)).forEach(file => {
    const filePath = Path.join(cacheDirectory, file);

    try {
      // Attempt to make file writable if needed
      fs.accessSync(filePath, fs.constants.W_OK);
    } catch (error: unknown) {
      if (error instanceof Error) {
        log.warn(`File not writable, attempting to change permissions for: ${filePath}`);
        try {
          fs.chmodSync(filePath, 0o666); // Best-effort for UNIX-like systems
          log.debug(`OK: Permissions changed to 0666 for: ${filePath}`);
        } catch (chmodError: unknown) {
          if (chmodError instanceof Error) {
            log.warn(`Failed to change permissions for file: ${filePath}. Error: ${chmodError.message}`);
          } else {
            log.warn(`Failed to change permissions for file: ${filePath}. Unknown error`);
          }
        }
      } else {
        log.warn(`File not writable, unknown error while checking permissions for: ${filePath}`);
      }
    }

    try {
      const stats = fs.statSync(filePath);
      const fileAge = now - stats.mtimeMs;

      // If the file is older than 2 days, clean up
      if (fileAge >= 172800 * 1000 * 2) {
        fs.unlinkSync(filePath);
        log.debug(`OK: Deleted old cache file: ${filePath}`);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        log.warn(`Failed to access file stats or delete file: ${filePath}. Error: ${error.message}`);
      } else {
        log.warn(`Failed to access file stats or delete file: ${filePath}. Unknown error`);
      }
    }
  });

  return new Cache({ basePath: cacheDirectory, ns: ns, ttl: 172800 });
}

// same timezone applies to all Nordpool zones: LT, LV, EE, FI
export const defaultAreaTimezone = 'Europe/Vilnius';

export function fnc_todayKey() {
  return DateTime.local().setZone(defaultAreaTimezone).toFormat('yyyy-MM-dd');
}
export function fnc_tomorrowKey() {
  return DateTime.local().plus({ day: 1 }).setZone(defaultAreaTimezone).toFormat('yyyy-MM-dd');
}
export function fnc_currentHour() {
  return DateTime.local().setZone(defaultAreaTimezone).hour;
}
