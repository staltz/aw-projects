import xs, {Stream} from 'xstream';
import {color} from 'csx';
import dropRepeats from 'xstream/extra/dropRepeats';
import flattenConcurrently from 'xstream/extra/flattenConcurrently';
import {StateSource, Reducer, Lens} from 'cycle-onionify';
import {div, h2, button, DOMSource, VNode} from '@cycle/dom';
import {HTTPSource, RequestInput} from '@cycle/http';
import isolate from '@cycle/isolate';
import startOfToday = require('date-fns/start_of_today');
import addHours = require('date-fns/add_hours');
import addSeconds = require('date-fns/add_seconds');
import isAfter = require('date-fns/is_after');
import isBefore = require('date-fns/is_before');
import format = require('date-fns/format');
import {AWBucket, AWEvent} from './types';
import spectrum, {State as SpectrumState} from './spectrum';
import {style} from 'typestyle';

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

const isBetween = (
  time: string | Date,
  min: string | Date,
  max: string | Date,
) => {
  return isAfter(time, min) && isBefore(time, max);
};

const spectrumLens: Lens<State, SpectrumState> = {
  get(parent: State): SpectrumState {
    const {start, end} = parent.timeWindow;
    const happenedOnSelectedDay = (ev: AWEvent) => {
      const evStart = ev.timestamp;
      const evEnd = addSeconds(ev.timestamp, ev.duration);
      return isBetween(evStart, start, end) || isBetween(evEnd, start, end);
    };
    return {
      timeWindow: parent.timeWindow,
      events: parent.events.filter(happenedOnSelectedDay),
    };
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

export type Actions = {
  changeDay$: Stream<number>;
};

function intent(domSource: DOMSource) {
  return {
    changeDay$: xs.merge(
      domSource
        .select('.previous')
        .events('click')
        .mapTo(-1),

      domSource
        .select('.next')
        .events('click')
        .mapTo(+1),
    ),
  };
}

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
            start: state.timeWindow.start.toISOString(),
            end: state.timeWindow.end.toISOString(),
          },
        })),
      ),
    )
    .compose(flattenConcurrently);

  return xs.merge(infoReq$, bucketsReq$, eventsReq$);
}

function model(
  actions: Actions,
  httpSource: HTTPSource,
): Stream<Reducer<State>> {
  const initReducer$ = xs.of(function initReducer(): State {
    const selectedDay = 0;
    return {
      buckets: [],
      events: [],
      selectedDay,
      timeWindow: recentDays[selectedDay],
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

  const changeDayReducer$ = actions.changeDay$.map(
    delta =>
      function changeDayReducer(prev: State): State {
        const newSelectedDay = Math.max(
          Math.min(prev.selectedDay - delta, recentDays.length - 1),
          0,
        );
        if (newSelectedDay === prev.selectedDay) {
          return prev;
        }
        return {
          ...prev,
          selectedDay: newSelectedDay,
          timeWindow: recentDays[newSelectedDay],
        };
      },
  );

  return xs.merge(
    initReducer$,
    infoReducer$,
    bucketsReducer$,
    eventsReducer$,
    changeDayReducer$,
  );
}

const indigo = color('#3B5BDB');

namespace styles {
  export const header = style({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
    height: '60px',
  });

  export const title = style({
    margin: '0',
  });

  export const button = style({
    backgroundColor: indigo.toHexString(),
    borderRadius: 2,
    borderLeft: 'none',
    borderRight: 'none',
    borderTop: 'none',
    borderBottom: `3px solid ${indigo.darken(10).toHexString()}`,
    alignSelf: 'stretch',
    color: 'white',
    padding: '0 35px',
  });
}

function view(state$: Stream<State>, spectrum$: Stream<VNode>): Stream<VNode> {
  return xs
    .combine(state$, spectrum$)
    .map(([state, spectrum]) =>
      div([
        div(`.header.${styles.header}`, [
          button(`.previous.${styles.button}`, 'prev'),
          h2(
            `.title.${styles.title}`,
            (state.hostname || '') +
              ' ' +
              format(state.timeWindow.start, 'YYYY-MM-DD'),
          ),
          button(`.next.${styles.button}`, 'next'),
        ]),
        spectrum,
      ]),
    );
}

export default function main(sources: Sources): Sinks {
  const spectrumSinks = isolate(spectrum, {
    onion: spectrumLens,
    '*': 'spectrum',
  })(sources);

  const actions = intent(sources.dom);
  const request$ = http(sources.http, sources.onion.state$);
  const vdom$ = view(sources.onion.state$, spectrumSinks.dom);
  const reducer$ = model(actions, sources.http);

  return {
    dom: vdom$,
    http: request$,
    onion: reducer$,
  };
}
