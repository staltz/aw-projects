import xs, {Stream} from 'xstream';
import sampleCombine from 'xstream/extra/sampleCombine';
import flattenConcurrently from 'xstream/extra/flattenConcurrently';
import {StateSource, Reducer, Lens} from 'cycle-onionify';
import {div, ul, li, h2, DOMSource, VNode} from '@cycle/dom';
import {HTTPSource, RequestInput} from '@cycle/http';
import isolate from '@cycle/isolate';
import startOfToday = require('date-fns/start_of_today');
import addHours = require('date-fns/add_hours');
import isAfter = require('date-fns/is_after');
import {AWBucket, AWEvent} from './types';
import spectrum, {State as SpectrumState} from './spectrum';

export type State = {
  hostname?: string;
  buckets: Array<AWBucket>;
  events: Array<AWEvent>;
  selectedDay: number;
  timeWindow: {
    start: Date;
    end: Date;
  };
};

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

const spectrumLens: Lens<State, SpectrumState> = {
  get(parent: State): SpectrumState {
    return parent;
  },

  // no set
  set(parent: State, child: SpectrumState): State {
    return parent;
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

  const eventsReq$ = httpSource
    .select('buckets')
    .flatten()
    .map(res => res.body)
    .compose(sampleCombine(state$))
    .map(([buckets, state]) =>
      xs.fromArray(
        Object.keys(buckets).map(bucketId => ({
          url: `http://${HOST}/api/0/buckets/${bucketId}/events`,
          method: 'GET',
          category: 'events',
          query: {
            start: state.timeWindow.start.toISOString(),
            end: state.timeWindow.end.toISOString(),
          },
        })),
      ),
    )
    .compose(flattenConcurrently);

  return xs.merge(infoReq$, bucketsReq$, eventsReq$);
}

function model(httpSource: HTTPSource): Stream<Reducer<State>> {
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

  const initReducer$ = xs.of(function initReducer(): State {
    const selectedDay = 0;
    return {
      buckets: [],
      events: [],
      selectedDay,
      timeWindow: recentDays[selectedDay],
    };
  });

  return xs.merge(initReducer$, infoReducer$, bucketsReducer$, eventsReducer$);
}

function view(state$: Stream<State>, spectrum$: Stream<VNode>): Stream<VNode> {
  return xs
    .combine(state$, spectrum$)
    .map(([state, spectrum]) =>
      div([
        h2(state.hostname || ''),
        ul(state.buckets.map(bucket => li(bucket.id))),
        spectrum,
      ]),
    );
}

export default function main(sources: Sources): Sinks {
  const spectrumSinks = isolate(spectrum, {
    onion: spectrumLens,
    '*': 'spectrum',
  })(sources);

  const request$ = http(sources.http, sources.onion.state$);
  const vdom$ = view(sources.onion.state$, spectrumSinks.dom);
  const reducer$ = model(sources.http);

  return {
    dom: vdom$,
    http: request$,
    onion: reducer$,
  };
}
