import { DateTime } from 'luxon';
import { defaultAreaTimezone } from './settings';
import axios from 'axios';
import { Logger, PlatformConfig } from 'homebridge';
// import { map } from 'ramda';


export async function eleringEE_getNordpoolData(log:Logger, config:PlatformConfig) {
  const start = DateTime.utc().startOf('day').minus({hours:2}).toISO();
  const end = DateTime.utc().plus({days:1}).endOf('day').minus({hours:2}).toISO();

  const encodedStart = encodeURIComponent(start);
  const encodedEnd = encodeURIComponent(end);

  try {
    const url = `https://api.awattar.at/v1/marketdata?start=${encodedStart}&end=${encodedEnd}`;

    const response = await axios.get(url);

    log.warn(`Werte ${JSON.stringify(response.data)}`);
    //log.warn(`Werte ${JSON.stringify(response.data.data)}`);

    log.info(response.data.data);
    //log.info(response.data);
    log.info(`${response.status}`);
    log.info(response.statusText);
    log.info(`${response.headers}`);
    log.info(`Config:${response.config}`);


    //log.info(`ConvertedData:, ${Array.of.json(eleringEE_convertDataStructure(response.data.data, config)))}`);

    if (response.status !== 200 ) {
      log.warn(`WARN: Nordpool API provider Elering returned unusual response status ${response.status}`);
      log.warn(`Werte ${JSON.stringify(response.data)}`);
    }

    if (response.data.data) {
      const convertedData = eleringEE_convertDataStructure(response.data.data, config);
      log.info(`convertedData: ${convertedData}`);
      return convertedData;

    } else {
      log.error(`ERR: Nordpool API provider Elering returned unusual data ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    log.error(`ERR: General Nordpool API provider Elering error: ${error}`);
  }
  return null;

}



export function eleringEE_convertDataStructure(
  data: { start_timestamp: number; marketprice: number }[],
  config: PlatformConfig,
) {
  //const area = config.area.toLowerCase();
  const decimalPrecision = config.decimalPrecision ?? 1;
  [];

  return data.map ((item: { start_timestamp: number; marketprice: number }) => {
    // convert the timestamp to ISO string, add the '+01:00' timezone offset
    const date = DateTime.fromISO(new Date(item.start_timestamp).toISOString()).setZone(defaultAreaTimezone);
    //const data = useState([]);
    // divide by 10 to convert price to cents per kWh
    item.marketprice = parseFloat((item.marketprice / 10).toFixed(decimalPrecision));



    return {
      day: date.toFormat('yyyy-MM-dd'),
      hour: parseInt(date.toFormat('HH')),
      price: item.marketprice,
    };



  });

}


