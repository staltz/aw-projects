import {run} from '@cycle/run';
import onionify from 'cycle-onionify';
import {makeDOMDriver} from '@cycle/dom';
import {makeHTTPDriver} from '@cycle/http';
import {forceRenderStyles} from 'typestyle';
import main from './main';

run(onionify(main), {
  dom: makeDOMDriver('#main-container'),
  http: makeHTTPDriver(),
});
forceRenderStyles();
