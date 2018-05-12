import xs, {Stream} from 'xstream';
import dropRepeats from 'xstream/extra/dropRepeats';
import flattenConcurrently from 'xstream/extra/flattenConcurrently';
import {StateSource, Reducer, Lens} from 'cycle-onionify';
import {div, DOMSource, VNode} from '@cycle/dom';
import {HTTPSource, RequestInput} from '@cycle/http';
import isolate from '@cycle/isolate';
import startOfToday = require('date-fns/start_of_today');
import addHours = require('date-fns/add_hours');
import addSeconds = require('date-fns/add_seconds');
import isAfter = require('date-fns/is_after');
import isBefore = require('date-fns/is_before');
import {AWBucket, AWEvent} from './types';
import spectrum, {State as SpectrumState} from './spectrum';
import header, {State as HeaderState} from './header';

export type State = {
  hostname?: string;
  buckets: Array<AWBucket>;
  events: Array<AWEvent>;
  selectedDay: number;
  days: Array<{start: Date; end: Date}>;
};

function isBetween(time: string | Date, min: Date, max: Date) {
  return isAfter(time, min) && isBefore(time, max);
}

const spectrumLens: Lens<State, SpectrumState> = {
  get(parent: State): SpectrumState {
    const timeWindow = parent.days[parent.selectedDay];
    const {start, end} = timeWindow;
    const happenedOnSelectedDay = (ev: AWEvent) => {
      const evStart = ev.timestamp;
      const evEnd = addSeconds(ev.timestamp, ev.duration);
      return isBetween(evStart, start, end) || isBetween(evEnd, start, end);
    };
    return {
      timeWindow: timeWindow,
      events: parent.events.filter(happenedOnSelectedDay),
    };
  },

  // no set
  set(parent: State, child: SpectrumState): State {
    return parent;
  },
};

const headerLens: Lens<State, HeaderState> = {
  get(parent: State): HeaderState {
    return {
      hostname: parent.hostname || '',
      days: parent.days.map(day => day.start),
      selectedDay: parent.selectedDay,
    };
  },

  set(parent: State, child: HeaderState): State {
    return {
      ...parent,
      selectedDay: child.selectedDay,
    };
  },
};

export type Sources = {
  dom: DOMSource;
  http: HTTPSource;
  onion: StateSource<State>;
};

export type Sinks = {
  dom: Stream<VNode>;
  http: Stream<RequestInput>;
  onion: Stream<Reducer<State>>;
};

const HOST = 'localhost:5600';

function http(httpSource: HTTPSource, state$: Stream<State>) {
  const infoReq$ = xs.of({
    url: `http://${HOST}/api/0/info`,
    method: 'GET',
    category: 'info',
  });

  const bucketsReq$ = xs.of({
    url: `http://${HOST}/api/0/buckets`,
    method: 'GET',
    category: 'buckets',
  });

  const eventsReq$ = state$
    .filter(s => s.buckets.length > 0)
    .compose(dropRepeats((s1, s2) => s1.selectedDay === s2.selectedDay))
    .map(state =>
      xs.fromArray(
        state.buckets.map(bucket => ({
          url: `http://${HOST}/api/0/buckets/${bucket.id}/events`,
          method: 'GET',
          category: 'events',
          query: {
            start: state.days[state.selectedDay].start.toISOString(),
            end: state.days[state.selectedDay].end.toISOString(),
          },
        })),
      ),
    )
    .compose(flattenConcurrently);

  return xs.merge(infoReq$, bucketsReq$, eventsReq$);
}

function model(httpSource: HTTPSource): Stream<Reducer<State>> {
  const initReducer$ = xs.of(function initReducer(): State {
    const recentDays = ((length: number) => {
      let startOfThisWorkDay = addHours(startOfToday(), 4);
      if (isAfter(startOfThisWorkDay, Date.now())) {
        startOfThisWorkDay = addHours(startOfThisWorkDay, -24);
      }
      let result = [];
      for (let i = 0; i < length; i++) {
        const x = addHours(startOfThisWorkDay, -i * 24);
        result.push({start: x, end: addHours(x, 24)});
      }
      return result;
    })(7);

    return {
      buckets: [],
      events: [],
      selectedDay: 0,
      days: recentDays,
    };
  });

  const infoReducer$ = httpSource
    .select('info')
    .flatten()
    .map(
      res =>
        function infoReducer(prev: State): State {
          return {...prev, hostname: res.body.hostname};
        },
    );

  const bucketsReducer$ = httpSource
    .select('buckets')
    .flatten()
    .map(
      res =>
        function bucketsReducer(prev: State): State {
          const buckets = Object.keys(res.body).map(key => res.body[key]);
          return {...prev, buckets};
        },
    );

  const eventsReducer$ = httpSource
    .select('events')
    .compose(flattenConcurrently)
    .map(
      res =>
        function eventsReducer(prev: State): State {
          const newEvents = res.body;
          return {...prev, events: prev.events.concat(newEvents)};
        },
    );

  return xs.merge(initReducer$, infoReducer$, bucketsReducer$, eventsReducer$);
}

function view(header$: Stream<VNode>, spectrum$: Stream<VNode>): Stream<VNode> {
  return xs
    .combine(header$, spectrum$)
    .map(([header, spectrum]) => div([header, spectrum]));
}

export default function main(sources: Sources): Sinks {
  const spectrumSinks: Sinks = isolate(spectrum, {
    onion: spectrumLens,
    '*': 'spectrum',
  })(sources);

  const headerSinks: Sinks = isolate(header, {
    onion: headerLens,
    '*': 'header',
  })(sources);

  const request$ = http(sources.http, sources.onion.state$);
  const vdom$ = view(headerSinks.dom, spectrumSinks.dom);
  const mainReducer$ = model(sources.http);
  const reducer$ = xs.merge(
    mainReducer$,
    spectrumSinks.onion,
    headerSinks.onion,
  );

  return {
    dom: vdom$,
    http: request$,
    onion: reducer$,
  };
}
