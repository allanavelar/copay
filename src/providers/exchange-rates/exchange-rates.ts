import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import * as _ from 'lodash';
import * as moment from 'moment';
import { Observable } from 'rxjs/Observable';
import { shareReplay } from 'rxjs/operators';
import { ConfigProvider, Logger } from '../../providers';
import { CoinsMap, CurrencyProvider } from '../../providers/currency/currency';

export interface ApiPrice {
  ts: number;
  rate: number;
  fetchedOn: number;
}

@Injectable()
export class ExchangeRatesProvider {
  private bwsURL: string;
  private ratesCache:
    | object
    | CoinsMap<{
        1?: Observable<ApiPrice[]>;
        7?: Observable<ApiPrice[]>;
        31?: Observable<ApiPrice[]>;
      }> = {};

  constructor(
    private currencyProvider: CurrencyProvider,
    private httpClient: HttpClient,
    private logger: Logger,
    private configProvider: ConfigProvider
  ) {
    this.logger.debug('ExchangeRatesProvider initialized');
    const defaults = this.configProvider.getDefaults();
    this.bwsURL = defaults.bws.url;
    for (const coin of this.currencyProvider.getAvailableCoins()) {
      this.ratesCache[coin] = {};
    }
  }

  public getLastDayRates(): Promise<any> {
    const isoCode =
      this.configProvider.get().wallet.settings.alternativeIsoCode || 'USD';
    const availableChains = this.currencyProvider.getAvailableChains();
    return new Promise(resolve => {
      let ratesByCoin = {};
      _.forEach(availableChains, coin => {
        this.getHistoricalRates(coin, isoCode).subscribe(
          response => {
            ratesByCoin[coin] = _.last(response).rate;
          },
          err => {
            this.logger.error('Error getting current rate:', err);
            return resolve(ratesByCoin);
          }
        );
      });
      return resolve(ratesByCoin);
    });
  }

  public getHistoricalRates(
    coin: string,
    isoCode: string,
    force: boolean = false,
    dateOffset = 1
  ): Observable<ApiPrice[]> {
    const observableBatch = [];
    const historicalDates = this.setDates(dateOffset);

    if (!this.ratesCache[coin][dateOffset] || force) {
      _.forEach(historicalDates, date => {
        observableBatch.push(
          this.httpClient.get<ApiPrice>(
            `${this.bwsURL}/v1/fiatrates/${isoCode}?coin=${coin}&ts=${date}`
          )
        );
      });
      this.ratesCache[coin][dateOffset] = Observable.forkJoin(
        observableBatch
      ).pipe(shareReplay());
    }
    return this.ratesCache[coin][dateOffset];
  }

  public getCurrentRate(isoCode, coin?): Observable<ApiPrice> {
    return this.httpClient.get<ApiPrice>(
      `${this.bwsURL}/v1/fiatrates/${isoCode}?coin=${coin}`
    );
  }

  private setDates(dateOffset: number): number[] {
    const intervals = 120;
    const today = new Date().getTime();
    const lastDate =
      moment()
        .subtract(dateOffset, 'days')
        .unix() * 1000;
    const historicalDates = [lastDate];
    const intervalOffset = Math.round((today - lastDate) / intervals);

    for (let i = 0; i <= intervals; i++) {
      const intervalTime = historicalDates[i] + intervalOffset;
      if (intervalTime < today) {
        historicalDates.push(intervalTime);
      } else {
        break;
      }
    }
    historicalDates.push(today);
    return historicalDates.reverse();
  }
}
