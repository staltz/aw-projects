import xs, {Stream} from 'xstream';
import {DOMSource, VNode, div, button, h2} from '@cycle/dom';
import {StateSource, Reducer} from 'cycle-onionify';
import format = require('date-fns/format');
import {style} from 'typestyle';
import {color} from 'csx';

export type State = {
  hostname: string;
  days: Array<Date>;
  selectedDay: number;
};

export type Sources = {
  dom: DOMSource;
  onion: StateSource<State>;
};

export type Sinks = {
  dom: Stream<VNode>;
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

function model(actions: Actions): Stream<Reducer<State>> {
  const initReducer$ = xs.of(function initReducer(prev?: State): State {
    if (prev) return prev;
    return {
      hostname: '',
      selectedDay: 0,
      days: [],
    };
  });

  const changeDayReducer$ = actions.changeDay$.map(
    delta =>
      function changeDayReducer(prev: State): State {
        const newSelectedDay = Math.max(
          Math.min(prev.selectedDay - delta, prev.days.length - 1),
          0,
        );
        if (newSelectedDay === prev.selectedDay) {
          return prev;
        }
        return {
          ...prev,
          selectedDay: newSelectedDay,
        };
      },
  );

  return xs.merge(initReducer$, changeDayReducer$);
}

namespace styles {
  const indigo = color('#3B5BDB');

  export const header = style({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: '15px',
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

function view(state$: Stream<State>): Stream<VNode> {
  return state$.map(state =>
    div(`.header.${styles.header}`, [
      button(`.previous.${styles.button}`, 'prev'),
      h2(
        `.title.${styles.title}`,
        (state.hostname || '') +
          ' ' +
          format(state.days[state.selectedDay], 'YYYY-MM-DD'),
      ),
      button(`.next.${styles.button}`, 'next'),
    ]),
  );
}

export default function header(sources: Sources): Sinks {
  const actions = intent(sources.dom);
  const vdom$ = view(sources.onion.state$);
  const reducer$ = model(actions);

  return {
    dom: vdom$,
    onion: reducer$,
  };
}
