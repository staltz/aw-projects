import {run} from '@cycle/run';
import onionify from 'cycle-onionify';
import {makeDOMDriver} from '@cycle/dom';
import {makeHTTPDriver} from '@cycle/http';
import {forceRenderStyles, cssRule} from 'typestyle';
import main from './main';

cssRule('body', {
  margin: 0,
  fontFamily: '"Source Sans Pro", serif',
  backgroundColor: '#e5e5e5',
  fontWeight: 400,
});

run(onionify(main), {
  dom: makeDOMDriver('#main-container'),
  http: makeHTTPDriver(),
});
forceRenderStyles();
