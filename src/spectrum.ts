import xs, {Stream} from 'xstream';
import {StateSource, Reducer} from 'cycle-onionify';
import {DOMSource, VNode, svg, div} from '@cycle/dom';
import {AWEvent} from './types';
import {style} from 'typestyle';
import {color} from 'csx';
import differenceInSeconds = require('date-fns/difference_in_seconds');
import addSeconds = require('date-fns/add_seconds');

namespace styles {
  export const container = style({
    position: 'relative',
    height: '100px',
    backgroundColor: '#ffffff',
  });

  export const canvas = style({
    width: '100%',
    height: '100%',

    $nest: {
      'rect:hover': {
        opacity: 0.8,
      },
    },
  });
}

export type State = {
  events: Array<AWEvent>;
  timeWindow: {
    start: Date;
    end: Date;
  };
};

export type Sources = {
  dom: DOMSource;
  onion: StateSource<State>;
};
export type Sinks = {
  dom: Stream<VNode>;
  onion: Stream<Reducer<State>>;
};

const mycolor = color('#3B5BDB');

const MAX_X = 100;
const MAX_Y = 20;

function timeToX(time: string | Date, state: State): number {
  const total = differenceInSeconds(
    state.timeWindow.end,
    state.timeWindow.start,
  );
  const target = differenceInSeconds(time, state.timeWindow.start);
  return target / total * MAX_X;
}

function renderEvent(event: AWEvent, state: State) {
  const start = event.timestamp;
  const end = addSeconds(event.timestamp, event.duration);
  const x = timeToX(start, state);
  return svg.rect({
    attrs: {
      x: x,
      width: timeToX(end, state) - x,
      height: MAX_Y,
      fill: mycolor.spin(360 * x / MAX_X),
    },
  });
}

function renderEvents(state: State) {
  return state.events.map(event => renderEvent(event, state));
}

function view(state$: Stream<State>) {
  const svgAttrs = {
    attrs: {
      xmlns: 'http://www.w3.org/2000/svg',
      preserveAspectRatio: 'none',
      viewBox: `0 0 ${MAX_X} ${MAX_Y}`,
    },
  };

  return state$.map(state =>
    div(`.${styles.container}`, [
      svg(`.${styles.canvas}`, svgAttrs, [...renderEvents(state)]),
    ]),
  );
}
export default function spectrum(sources: Sources): Sinks {
  const vdom$ = view(sources.onion.state$);

  return {
    dom: vdom$,
    onion: xs.never(),
  };
}
