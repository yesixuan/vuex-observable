import { Subject, from, queueScheduler } from 'rxjs';
import { map, mergeMap, observeOn, subscribeOn } from 'rxjs/operators';
import { ActionsObservable } from 'redux-observable';
import { StateObservable } from 'redux-observable';

const getType = target => typeof target === 'object' && target.type
  ? target.type
  : target

// options 整合好的 Epic
export function createEpicPlugin(options = {}) {
  const QueueScheduler = queueScheduler.constructor;
  const uniqueQueueScheduler = new QueueScheduler(queueScheduler.SchedulerAction);

  if (process.env.NODE_ENV !== 'production' && typeof options === 'function') {
    throw new TypeError('Providing your root Epic to `createEpicPlugin(rootEpic)` is no longer supported, instead use `epicPlugin.run(rootEpic)`\n\nLearn more: https://redux-observable.js.org/MIGRATION.html#setting-up-the-plugin');
  }

  const epic$ = new Subject();
  let store;

  const epicPlugin = _store => {
    if (process.env.NODE_ENV !== 'production' && store) {
      console.warn('this plugin is already associated with a store. createEpicPlugin should be called for every store.\n\nLearn more: https://goo.gl/2GQ7Da');
    }
    store = _store;
    const actionSubject$ = new Subject().pipe(
      observeOn(uniqueQueueScheduler)
    );
    const stateSubject$ = new Subject().pipe(
      observeOn(uniqueQueueScheduler)
    );
    const action$ = new ActionsObservable(actionSubject$);
    const state$ = new StateObservable(stateSubject$, store.state);

    // 将所有 epic 返回的流聚合到了一起
    const result$ = epic$.pipe(
      map(epic => {
        const output$ = 'dependencies' in options
          ? epic(action$, state$, options.dependencies)
          : epic(action$, state$);

        if (!output$) {
          throw new TypeError(`Your root Epic "${epic.name || '<anonymous>'}" does not return a stream. Double check you\'re not missing a return statement!`);
        }

        return output$;
      }),
      mergeMap(output$ =>
        from(output$).pipe(
          subscribeOn(uniqueQueueScheduler),
          observeOn(uniqueQueueScheduler)
        )
      ),
    );

    // 一旦有 action 出来，就执行 dispatch 方法
    // 在创建的 $action 中，一定会发射另外的 $action
    // result$.subscribe(store.dispatch);
    result$.subscribe(action => {
      const type = getType(action)
      // 有时候我们希望什么都不做，但是 epic 要求一定要发出一个流。
      if (type === '@@observable/nothing') {
        return
      }
      if (typeof action === 'object' && action.isAction) {
        store.dispatch(action);
      } else {
        store.commit(action);
      }
    });

    const { dispatch, commit } = store;
    store.dispatch = (...args) => {
      typeof args[0] === 'object'
        ? actionSubject$.next(args[0])
        : actionSubject$.next({ type: args[0], payload: args[1] })

      const type = getType(args[0])
      // 如果定义了 action 就执行原来的 action， 没有就作罢
      if (store._actions[type]) {
        if (typeof args[0] === 'object') {
          return dispatch.call(store, args[0].type, args[0].payload || null);
        }
        return dispatch.call(store, ...args);
      }
    };
    store.commit = (...args) => {
      const type = getType(args[0])

      // 如果定义了 mutation 就执行原来的 mutation， 没有就作罢
      if (store._mutations[type]) {
        if (typeof args[0] === 'object') {
          commit.call(store, args[0].type, args[0].payload || null);
        } else {
          commit.call(store, ...args);
        }
        stateSubject$.next(store.state);
      }
    }
  };

  epicPlugin.run = rootEpic => {
    if (process.env.NODE_ENV !== 'production' && !store) {
      console.warn('epicPlugin.run(rootEpic) called before the plugin has been setup by vuex. Provide the epicPlugin instance to new Vuex.Store() first.');
    }
    epic$.next(rootEpic);
  };

  return epicPlugin;
}
