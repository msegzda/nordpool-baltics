import { PlatformAccessory } from 'homebridge';
import { NordpoolPlatform } from './platform';

import { DateTime } from 'luxon';
import axios from 'axios';
import * as asciichart from 'asciichart';


import {
  defaultAreaTimezone, PLATFORM_MANUFACTURER, PLATFORM_MODEL, PLATFORM_SERIAL_NUMBER,
  Pricing, NordpoolData, SensorType,
} from './settings';

export class Functions {

  private decimalPrecision = this.platform.config.decimalPrecision ?? 1;
  private excessivePriceMargin = this.platform.config.excessivePriceMargin ?? 200;
  private plotTheChart:boolean = this.platform.config.plotTheChart ?? false;

  constructor(
    private readonly platform: NordpoolPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly pricing: Pricing,
    private readonly service: SensorType,
  ) {}

  async initAccessories() {

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLATFORM_MANUFACTURER)
      .setCharacteristic(this.platform.Characteristic.Model, PLATFORM_MODEL)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, PLATFORM_SERIAL_NUMBER);

    // init light sensor for current price
    this.service.currently = this.accessory.getService('Nordpool_currentPrice') || this.accessory.addService(
      this.platform.Service.LightSensor, 'Nordpool_currentPrice', 'currentPrice');

    // set default price level
    if (this.service.currently) {
      this.service.currently.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
        .updateValue(this.pricing.currently);
    }

    // hourly ticker
    this.service.hourlyTickerSwitch = this.accessory.getService('Nordpool_hourlyTickerSwitch') || this.accessory.addService(
      this.platform.Service.Switch, 'Nordpool_hourlyTickerSwitch', 'hourlyTickerSwitch');

    // turn OFF hourly ticker if its turned on by schedule or manually
    if (this.service.hourlyTickerSwitch) {
      this.service.hourlyTickerSwitch.getCharacteristic(this.platform.Characteristic.On)
        .on('set', (value, callback) => {
          if(value) {
            // If switch is manually turned on, start a timer to switch it back off after 1 second
            setTimeout(() => {
              this.service.hourlyTickerSwitch!.updateCharacteristic(this.platform.Characteristic.On, false);
            }, 1000);
          }
          callback(null);
        });
    }

    // init virtual occupancy sensors for price levels
    for (const key of Object.keys(this.service)) {
      if (/^(cheapest|priciest)/.test(key)) {
        this.service[key] = this.accessory.getService(`Nordpool_${key}`)
        || this.accessory.addService(this.platform.Service.OccupancySensor, `Nordpool_${key}`, key);

        if ( this.service[key] ) {
        this.service[key]!
          .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
          .setValue(this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        }
      }
    }
  }

  async checkSystemTimezone() {
    const systemTimezone = DateTime.local().toFormat('ZZ');
    const preferredTimezone = DateTime.local().setZone(defaultAreaTimezone).toFormat('ZZ');

    if (systemTimezone !== preferredTimezone) {
      this.platform.log.warn(
        `WARN: System timezone ${systemTimezone} DOES NOT match with ${this.platform.config.area} area timezone ${preferredTimezone}.`
        + 'This may result in incorrect time-to-price coding. If possible, please update your system time setting to match timezone of '
        + 'your specified Nordpool area.',
      );
    } else {
      this.platform.log.debug(
        `OK: system timezone ${systemTimezone} match ${this.platform.config.area} area timezone ${preferredTimezone}`,
      );
    }
  }

  async eleringEE_getNordpoolData() {
    const start = DateTime.utc().startOf('day').minus({hours:4}).toISO();
    const end = DateTime.utc().plus({days:1}).endOf('day').toISO();

    const encodedStart = encodeURIComponent(start);
    const encodedEnd = encodeURIComponent(end);

    try {
      const url = `https://dashboard.elering.ee/api/nps/price?start=${encodedStart}&end=${encodedEnd}`;
      const response = await axios.get(url);
      if (response.status !== 200 ) {
        this.platform.log.warn(`WARN: Nordpool API provider Elering returned unusual response status ${response.status}`);
      }
      if (response.data.data) {
        const convertedData = this.eleringEE_convertDataStructure(response.data.data);
        return convertedData;
      } else {
        this.platform.log.error(`ERR: Nordpool API provider Elering returned unusual data ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      this.platform.log.error(`ERR: General Nordpool API provider Elering error: ${error}`);
    }
    return null;
  }

  eleringEE_convertDataStructure(
    data: { [x: string]: { timestamp: number; price: number }[] },
  ) {
    const area = this.platform.config.area.toLowerCase();
    const decimalPrecision = this.platform.config.decimalPrecision ?? 1;

    return data[area].map((item: { timestamp: number; price: number }) => {
      // convert the timestamp to ISO string, add the '+02:00' timezone offset
      const date = DateTime.fromISO(new Date(item.timestamp * 1000).toISOString()).setZone(defaultAreaTimezone);

      // divide by 10 to convert price to cents per kWh
      item.price = parseFloat((item.price / 10).toFixed(decimalPrecision));

      return {
        day: date.toFormat('yyyy-MM-dd'),
        hour: parseInt(date.toFormat('HH')),
        price: item.price,
      };
    });
  }

  getCheapestHoursToday() {
    if (this.pricing.today.length !== 24) {
      this.platform.log.warn(
        'WARN: Cannot determine cheapest hours of the day because Nordpool dataset is not available '
        + `or has abnormal amount of elements: ${this.pricing.today.length} (must be 24)`,
      );
      return;
    }

    const sortedPrices = [...this.pricing.today].sort((a, b) => a.price - b.price);

    // make sure these arrays are empty on each (new day) re-calculation
    for (const key of Object.keys(this.pricing)) {
      if (!/^(cheapest|priciest|cheapest5HoursConsec)/.test(key)) {
        continue;
      }
      this.pricing[key] = [];
    }

    this.pricing.median = parseFloat(
      ((sortedPrices[Math.floor(sortedPrices.length / 2) - 1].price +
          sortedPrices[Math.ceil(sortedPrices.length / 2)].price) / 2
      ).toFixed(this.decimalPrecision),
    );

    this.pricing.today
      .map((price, idx) => ({ value: price.price, hour: idx }))
      .forEach(({ value, hour }) => {
        if (value <= sortedPrices[0].price) {
          this.pricing.cheapestHour.push(hour);
        }
        if (value <= sortedPrices[3].price) {
          this.pricing.cheapest4Hours.push(hour);
        }
        if (value <= sortedPrices[4].price) {
          this.pricing.cheapest5Hours.push(hour);
        }
        if (value <= sortedPrices[5].price) {
          this.pricing.cheapest6Hours.push(hour);
        }
        if (value <= sortedPrices[6].price) {
          this.pricing.cheapest7Hours.push(hour);
        }
        if (value <= sortedPrices[7].price) {
          this.pricing.cheapest8Hours.push(hour);
        }
        if ((value >= (sortedPrices[23].price * 0.9) || value >= this.pricing.median * this.excessivePriceMargin/100)
                && !this.pricing.cheapest8Hours.includes(hour)
        ) {
          this.pricing.priciestHour.push(hour);
        }
      });

    this.platform.log.info(`Cheapest hour(s): ${this.pricing.cheapestHour.join(', ')}`);
    this.platform.log.info(`4 cheapest hours: ${this.pricing.cheapest4Hours.join(', ')}`);
    this.platform.log.info(`5 cheapest hours: ${this.pricing.cheapest5Hours.join(', ')}`);
    this.platform.log.info(`6 cheapest hours: ${this.pricing.cheapest6Hours.join(', ')}`);
    this.platform.log.info(`7 cheapest hours: ${this.pricing.cheapest7Hours.join(', ')}`);
    this.platform.log.info(`8 cheapest hours: ${this.pricing.cheapest8Hours.join(', ')}`);
    this.platform.log.info(`Most expensive hour(s): ${this.pricing.priciestHour.join(', ')}`);
    this.platform.log.info(`Median price today: ${this.pricing.median} cents`);

    if (this.plotTheChart) {
      this.plotPricesChart().then().catch((error)=> {
        this.platform.log.error('An error occurred plotting the chart for today\'s Nordpool data: ', error);
      });
    }

  }

  async getCheapestConsecutiveHours(numHours: number, pricesSequence: NordpoolData[] ): Promise<number[]> {
    interface HourSequence {
        startHour: number;
        total: number;
    }
    const hourSequences: HourSequence[] = [];

    for(let i = 0; i <= pricesSequence.length - numHours; i++) {
      const totalSum = pricesSequence.slice(i, i + numHours).reduce((total, priceObj) => total + priceObj.price, 0);
      hourSequences.push({ startHour: i, total: totalSum });
    }

    const cheapestHours = hourSequences.sort((a, b) => a.total - b.total)[0];
    const retVal = Array.from({length: numHours}, (_, i) => pricesSequence[cheapestHours.startHour + i].hour);

    this.platform.log.info(
      `Consecutive ${numHours} cheapest hours: ${retVal.join(', ')}`,
    );
    return retVal;
  }

  async plotPricesChart(){

    if (this.pricing.today.length !== 24) {
      this.platform.log.warn('Cannot plot the chart because not complete or no pricing information is available');
      return;
    }

    const priceData = this.pricing.today.map(elem => elem.price);

    const chart = asciichart.plot(priceData, {
      padding: '      ', // 6 spaces
      height: 9,
    });

    const lines = chart.split('\n');

    lines.forEach((line: string) => {
      this.platform.log.warn(line);
    });
  }

  setOccupancyByHour(currentHour: number, accessoryName: string) {
    let characteristic = this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;

    if (this.pricing[accessoryName].includes(currentHour)) {
      characteristic = this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
    }

    this.service[accessoryName]!.setCharacteristic(this.platform.Characteristic.OccupancyDetected, characteristic);
  }
}
