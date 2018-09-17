'use strict';

const Promise = require('bluebird');
const moment = require('moment');
const _ = require('lodash');
const elasticDateReader = require('../asset/elasticsearch_reader');
const harness = require('@terascope/teraslice-op-test-harness');
const MockClient = require('./mock_client');

describe('elasticsearch_reader', () => {
    const opTest = harness(elasticDateReader);

    it('has a schema, newSlicer and a newReader method', () => {
        const reader = elasticDateReader;

        expect(reader).toBeDefined();
        expect(reader.newSlicer).toBeDefined();
        expect(reader.schema).toBeDefined();
        expect(reader.newReader).toBeDefined();
        expect(typeof reader.newSlicer).toEqual('function');
        expect(typeof reader.newReader).toEqual('function');
        expect(typeof reader.schema).toEqual('function');
    });

    it('schema function returns on object, formatted to be used by convict', () => {
        const schema = elasticDateReader.schema();
        const type = Object.prototype.toString.call(schema);
        const keys = Object.keys(schema);

        expect(type).toEqual('[object Object]');
        expect(keys.length).toBeGreaterThan(0);
        expect(schema.size.default).toEqual(5000);
        expect(schema.interval.default).toEqual('auto');
    });

    it('can test geo validations', () => {
        const schema = elasticDateReader.schema();
        const geoPointValidation = schema.geo_box_top_left.format;
        const validGeoDistance = schema.geo_distance.format;
        const geoSortOrder = schema.geo_sort_order.format;

        expect(() => geoPointValidation()).not.toThrowError();
        expect(() => validGeoDistance()).not.toThrowError();
        expect(() => geoSortOrder()).not.toThrowError();

        expect(() => geoPointValidation(19.1234)).toThrowError('parameter must be a string IF specified');
        expect(() => geoPointValidation('19.1234')).toThrowError('Invalid geo_point, received 19.1234');
        expect(() => geoPointValidation('190.1234,85.2134')).toThrowError('latitude parameter is incorrect, was given 190.1234, should be >= -90 and <= 90');
        expect(() => geoPointValidation('80.1234,185.2134')).toThrowError('longitutde parameter is incorrect, was given 185.2134, should be >= -180 and <= 180');
        expect(() => geoPointValidation('80.1234,-155.2134')).not.toThrowError();

        expect(() => validGeoDistance(19.1234)).toThrowError('parameter must be a string IF specified');
        expect(() => validGeoDistance(' ')).toThrowError('geo_distance paramter is formatted incorrectly');
        expect(() => validGeoDistance('200something')).toThrowError('unit type did not have a proper unit of measuerment (ie m, km, yd, ft)');
        expect(() => validGeoDistance('200km')).not.toThrowError();

        expect(() => geoSortOrder(1234)).toThrowError('parameter must be a string IF specified');
        expect(() => geoSortOrder('hello')).toThrowError('if geo_sort_order is specified it must be either "asc" or "desc"');
        expect(() => geoSortOrder('asc')).not.toThrowError();
    });

    it('newReader returns a function that queries elasticsearch', async () => {

        const executionConfig = { 
            lifecycle: 'once',
             operations: [ {
                _op: 'elasticsearch_reader',
                date_field_name: '@timestamp',
                size: 50,
                index: 'someIndex',
                full_response: true
            }]
        };

        const type = 'reader';

        const reader = await opTest.init({ executionConfig, type });
        expect(typeof reader.operation).toEqual('function');
    });

    it('newReader can return formated data', async () => {
        const firstDate = moment();
        const laterDate = moment(firstDate).add(5, 'm');
        function makeConfig(op){
            return {
                lifecycle: 'once',
                operations: [op]
            }
        }
        const opConfig1 = {
            date_field_name: '@timestamp',
            size: 50,
            index: 'someIndex'
        };
        const opConfig2 = {
            date_field_name: '@timestamp',
            size: 50,
            index: 'someIndex',
            full_response: true
        };
        const opConfig3 = {
            date_field_name: '@timestamp',
            size: 50,
            index: 'someIndex',
            preserve_id: true
        };
        const jobConfig = { lifecycle: 'once' };
        const type = 'reader'

        const [reader1, reader2, reader3]= await Promise.all([
            opTest.init({ executionConfig: makeConfig(opConfig1), type }),
            opTest.init({ executionConfig: makeConfig(opConfig2), type }),
            opTest.init({ executionConfig: makeConfig(opConfig3), type })
        ])
    
        const msg = { count: 100, start: firstDate.format(), end: laterDate.format()}

        const response1 = [];
        const response2 = {"_shards":{"failed":0},"hits":{"total":100,"hits":[{"_source":{"@timestamp":"2018-08-24T19:09:48.134Z","count":100}}]}};

        const [results1, results2, results3] = await Promise.all([
            reader1.run(msg),
            reader2.run(msg),
            reader3.run(msg)
        ]);

        expect(Array.isArray(results1)).toEqual(true);
        expect(results1.hits).toEqual(undefined);
        expect(typeof results1[0]).toEqual('object');

        expect(results2.hits).toBeDefined();
        expect(results2.hits.hits).toBeDefined();
        expect(Array.isArray(results2.hits.hits)).toEqual(true);
        expect(results2.hits.hits[0]._id).toEqual('someId');
        
        expect(Array.isArray(results3)).toEqual(true);
        expect(results3.hits).toEqual(undefined);
        expect(typeof results3[0]).toEqual('object');
        expect(results3[0]._key).toEqual('someId');
    });

    it('newSlicer return a function', async () => {
        const opConfig = {
            _op: 'elasticsearch_reader',
            time_resolution: 's',
            date_field_name: '@timestamp',
            size: 50,
            index: 'someIndex',
            interval: '12hrs',
            start: new Date(),
            end: new Date()
        };
        const executionConfig = {
                lifecycle: 'once',
                slicers: 1,
                operations: [opConfig],
        };
        const client = new MockClient();

        const singleSlicer = await opTest.init({ executionConfig, client });
        expect(typeof singleSlicer.operation[0]).toEqual('function');
        expect(singleSlicer.operation.length).toEqual(1);

        executionConfig.slicers = 3;

        const multiSlicer = await opTest.init({ executionConfig, client });
        multiSlicer.operation.forEach(slicer => expect(typeof slicer).toEqual('function'));
        expect(multiSlicer.operation.length).toEqual(3);
    });

    it('slicers will throw if date_field_name does not exist on docs in the index', async () => {
        const opConfig = {
            _op: 'elasticsearch_reader',
            date_field_name: 'date',
            time_resolution: 's',
            size: 100,
            index: 'someIndex',
            interval: '2hrs',
            start: '2015-08-25T00:00:00',
            end: '2015-08-25T00:02:00'
        };
        const executionConfig = { lifecycle: 'once', slicers: 1, operations: [opConfig] };
        let error;

        const client = new MockClient();
        try {
            const opTest = await opTest.init({ executionConfig, client });
        } catch(err) {
            error = err;
        }
        
        expect(error instanceof Error).toEqual(true);
    });

    it('selfValidation makes sure necessary configuration combos work ', () => {
        const errorString = 'If subslice_by_key is set to true, the elasticsearch type parameter of the documents must also be set';
        const badOP = { subslice_by_key: true };
        const goodOP = { subslice_by_key: true, type: 'events-' };
        const otherGoodOP = { subslice_by_key: false, type: 'events-' };
        // NOTE: geo self validations are tested in elasticsearch_api module

        expect(() => {
            elasticDateReader.selfValidation(badOP);
        }).toThrowError(errorString);

        expect(() => {
            elasticDateReader.selfValidation(goodOP);
        }).not.toThrow();
        expect(() => {
            elasticDateReader.selfValidation(otherGoodOP);
        }).not.toThrow();
    });

    it('slicers will emit updated operations for start and end', async () => {
        const firstDate = moment();
        const laterDate = moment(firstDate).add(5, 'm');
        let updatedConfig;

        function checkUpdate(updateObj) {
            updatedConfig = _.get(updateObj, 'update[0]');
            return true;
        }

        const opConfig = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 100,
            index: 'someIndex',
            interval: '2hrs'
        };

        const opConfig2 = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 100,
            index: 'someIndex',
            interval: '2hrs',
            start: firstDate.format()
        };

        const opConfig3 = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 100,
            index: 'someIndex',
            interval: '2hrs',
            end: moment(laterDate).add(1, 's').format()
        };

        const opConfig4 = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 100,
            index: 'someIndex',
            interval: '2hrs',
            start: firstDate.format(),
            end: moment(laterDate).add(1, 's').format()
        };

        const executionConfig = { lifecycle: 'once', slicers: 1, operations: [_.cloneDeep(opConfig)] };

        opTest.events.on('slicer:execution:update', checkUpdate);

        async function waitForUpdate(opConfig, endDate) {
            const waitFor = () => new Promise(resolve => setTimeout(() => resolve(updatedConfig), 30))
            const client = new MockClient();
            client.setSequenceData([{ '@timestamp': firstDate }, { '@timestamp': endDate || laterDate }])
            const executionConfig = { lifecycle: 'once', slicers: 1, operations: [opConfig] };
            const test = await opTest.init({ executionConfig, client });
            return waitFor();
        }

        const updatedConfig1 = await waitForUpdate(opConfig, firstDate);
        expect(updatedConfig1.start).toEqual(firstDate.format());
        expect(updatedConfig1.end).toEqual(moment(firstDate).add(1, 's').format());

        const updatedConfig2 = await waitForUpdate(opConfig2);
        expect(updatedConfig2.start).toEqual(firstDate.format());
        expect(updatedConfig2.end).toEqual(moment(firstDate).add(5, 'm').add(1, 's').format());

        const updatedConfig3 = await waitForUpdate(opConfig3);
        expect(updatedConfig3.start).toEqual(firstDate.format());
        expect(updatedConfig3.end).toEqual(moment(firstDate).add(5, 'm').add(1, 's').format());

        const updatedConfig4 = await waitForUpdate(opConfig4);
        expect(updatedConfig4.start).toEqual(firstDate.format());
        expect(updatedConfig4.end).toEqual(moment(firstDate).add(5, 'm').add(1, 's').format());

        opTest.events.removeListener('slicer:execution:update', checkUpdate);
    });

    it('slicer will not error out if query returns no results', async () => {
        const opConfig = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 100,
            index: 'someIndex',
            interval: '2hrs',
            query: 'some:luceneQueryWithNoResults'
        };

        const executionConfig = { lifecycle: 'once', slicers: 1, operations: [opConfig] };
        const client = new MockClient();

        // setting sequence data to an empty array to simulate a query with no results
        client.setSequenceData([])
        const test = await opTest.init({ executionConfig, client });
        const results = await test.run();

        expect(results).toEqual(null)
    });

    it('slicer can produce date slices', async () => {
        const firstDate = moment();
        const laterDate = moment(firstDate).add(5, 'm');
        const closingDate = moment(laterDate).add(1, 's');
        const opConfig = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 100,
            index: 'someIndex',
            interval: '2hrs'
        };

        const executionConfig = { lifecycle: 'once', slicers: 1, operations: [opConfig] };       
        const client = new MockClient();
        // the last two data are not important here, they just need to exists as a response
        client.setSequenceData([
            { '@timestamp': firstDate },
            { '@timestamp': laterDate },
            { '@timestamp': laterDate },
            { '@timestamp': laterDate },
        ])
        const test = await opTest.init({ executionConfig, client });
        const results = await test.run();

        expect(results.start).toEqual(firstDate.format());
        expect(results.end).toEqual(closingDate.format());
        expect(results.count).toEqual(100);

        const results2 = await test.run();
        expect(results2).toEqual(null)
    });

    it('slicer can reduce date slices down to size', async () => {
        const firstDate = moment();
        const middleDate = moment(firstDate).add(5, 'm');
        const endDate = moment(firstDate).add(10, 'm');
        const closingDate = moment(endDate).add(1, 's');
        const opConfig = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 50,
            index: 'someIndex',
            interval: '2hrs',
        };

        const executionConfig = { lifecycle: 'once', slicers: 1, operations: [opConfig] };
        const client = new MockClient();
        // first two objects are consumed for determining start and end dates,
        // a middleDate is used in recursion to split in half, so it needs two

        client.setSequenceData([
            { '@timestamp': firstDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { '@timestamp': firstDate, count: 100 },
            { '@timestamp': middleDate, count: 50 },
            { '@timestamp': middleDate, count: 50 },
            { '@timestamp': endDate, count: 50 }
        ]);

        let hasRecursed = false;

        function hasRecursedEvent() {
            hasRecursed = true;
            return true;
        }

        opTest.events.on('slicer:slice:recursion', hasRecursedEvent);

        const test = await opTest.init({ executionConfig, client });
        const results = await test.run();

        expect(results.start).toEqual(firstDate.format());
        expect(results.end).toEqual(middleDate.format());
        expect(results.count).toEqual(50);

        const results2 = await test.run();

        expect(hasRecursed).toEqual(true);
        expect(results2.start).toEqual(middleDate.format());
        expect(results2.end).toEqual(closingDate.format());
        expect(results2.count).toEqual(50);

        const results3 = await test.run();

        expect(results3).toEqual(null)

        opTest.events.removeListener('slicer:slice:recursion', hasRecursedEvent);
    });

    it('slicer can do a simple expansion of date slices up to find data', async () => {
        const firstDate = moment();
        const endDate = moment(firstDate).add(10, 'm');
        const closingDate = moment(endDate).add(1, 's');
        const opConfig = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 100,
            index: 'someIndex',
            interval: '5m',
        };

        const executionConfig = { lifecycle: 'once', slicers: 1, operations: [opConfig] };
        // first two objects are consumed for determining start and end dates,
        // a middleDate is used in recursion to expand,
        const client = new MockClient();
        client.setSequenceData([
            { '@timestamp': firstDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { count: 0 },
            { count: 100 },
            { count: 100 },
            { count: 100 }
        ]);

        let hasExpanded = false;
        function hasExpandedFn() {
            hasExpanded = true;
            return true;
        }

        opTest.events.on('slicer:slice:range_expansion', hasExpandedFn);

        const test = await opTest.init({ executionConfig, client });
        const results = await test.run();

        expect(results.start).toEqual(firstDate.format());
        expect(results.end).toEqual(endDate.format());
        expect(results.count).toEqual(100);

        const results2 = await test.run();

        expect(hasExpanded).toEqual(true);
        expect(results2.start).toEqual(endDate.format());
        expect(results2.end).toEqual(closingDate.format());
        expect(results2.count).toEqual(100);

        const results3 = await test.run();
        expect(results3).toEqual(null)

        opTest.events.removeListener('slicer:slice:range_expansion', hasExpandedFn)
    });

    it('slicer can do expansion of date slices with large slices', async () => {
        const firstDate = moment();
        const middleDate = moment(firstDate).add(5, 'm');
        const endDate = moment(firstDate).add(10, 'm');
        const closingDate = moment(endDate).add(1, 's');

        const opConfig = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 100,
            index: 'someIndex',
            interval: '5m',
        };
        const executionConfig = { lifecycle: 'once', slicers: 1, operations: [opConfig] };
        const client = new MockClient();
        // first two objects are consumed for determining start and end dates,
        // the count of zero hits the expansion code, then it hits the 150 which is
        // above the size limit so it runs another recursive query
        client.setSequenceData([
            { '@timestamp': firstDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { count: 0 },
            { count: 150 },
            { count: 100 },
            { count: 100 },
            { count: 100 }
        ]);

        let hasExpanded = false;
        function hasExpandedFn() {
            hasExpanded = true;
            return true;
        }

        opTest.events.on('slicer:slice:range_expansion', hasExpandedFn);

        const test = await opTest.init({ executionConfig, client });
        const results = await test.run();

        expect(results.start).toEqual(firstDate.format());
        expect(moment(results.end).isBetween(middleDate, endDate)).toEqual(true);
        expect(results.count).toEqual(100);

        const results2 = await test.run();
        expect(hasExpanded).toEqual(true);
        expect(moment(results2.start).isBetween(middleDate, endDate)).toEqual(true);
        expect(results2.end).toEqual(closingDate.format());
        expect(results2.count).toEqual(100);

        const results3 = await test.run();
        expect(results3).toEqual(null)

        opTest.events.removeListener('slicer:slice:range_expansion', hasExpandedFn)
    });

    it('slicer can expand date slices properly in uneven data distribution', async () => {
        const firstDate = moment();
        const midDate = moment(firstDate).add(8, 'm');
        const endDate = moment(firstDate).add(16, 'm');
        const closingDate = moment(endDate).add(1, 's');

        const opConfig = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 100,
            index: 'someIndex',
            interval: '3m',
        };
        const executionConfig = { lifecycle: 'once', slicers: 1, operations: [opConfig] };
        const client = new MockClient();

        // first two objects are consumed for determining start and end dates,
        // the count of zero hits the expansion code, then it hits the 150 which is
        // above the size limit so it runs another recursive query
        client.setSequenceData([
            { '@timestamp': firstDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { count: 0 },
            { count: 150 },
            { count: 0 },
            { count: 100 },
            { count: 100 },
            { count: 100 },
            { count: 100 }
        ]);


        let hasExpanded = false;
        function hasExpandedFn() {
            hasExpanded = true;
            return true;
        }

        opTest.events.on('slicer:slice:range_expansion', hasExpandedFn);
        
        const test = await opTest.init({ executionConfig, client });
        const results = await test.run();

        expect(results.start).toEqual(firstDate.format());
        expect(moment(results.end).isBetween(firstDate, midDate)).toEqual(true);
        expect(results.count).toEqual(100);

        const results2 = await test.run();

        expect(moment(results2.end).isBetween(midDate, endDate)).toEqual(true);
        expect(hasExpanded).toEqual(true);
        expect(results2.count).toEqual(100);

        const results3 = await test.run();

        expect(moment(results3.end).isBetween(midDate, endDate)).toEqual(true);

        const results4 = await test.run();
        expect(results4.end).toEqual(closingDate.format());

        const results5 = await test.run();

        expect(results5).toEqual(null);
        
        opTest.events.removeListener('slicer:slice:range_expansion', hasExpandedFn);
    });

    it('slicer can will recurse down to smallest factor', async () => {
        const firstDateMS = moment().toISOString();
        const firstDateS = moment(firstDateMS);
        const closingDateS = moment(firstDateS).add(1, 's');
        const closingDateMS = moment(firstDateMS).add(1, 'ms');
        const endDate = moment(firstDateMS).add(5, 'm');

        const opConfig = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 10,
            index: 'someIndex',
            interval: '5m',
        };

        const opConfig2 = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 'ms',
            size: 10,
            index: 'someIndex',
            interval: '5m',
        };

        const executionConfig1 = { lifecycle: 'once', slicers: 1, operations: [opConfig] };
        const executionConfig2 = { lifecycle: 'once', slicers: 1, operations: [opConfig2] };
        const client1 = new MockClient();
        const client2 = new MockClient();
        
        client1.deepRecursiveResponseCount = 100;
        client2.deepRecursiveResponseCount = 100;
        // first two objects are consumed for determining start and end dates,
        // a middleDate is used in recursion to expand,
        client1.setSequenceData([
            { '@timestamp': firstDateS, count: 100 },
            { '@timestamp': endDate, count: 100 },
        ]);
        client2.setSequenceData([
            { '@timestamp': firstDateS, count: 100 },
            { '@timestamp': endDate, count: 100 }
        ]);
       
        const [slicerS, slicerMS] = await Promise.all([
            opTest.init({ executionConfig: executionConfig1, client: client1 }),
            opTest.init({ executionConfig: executionConfig2, client: client2 }),
        ])

        const [resultsSecond, resultsMillisecond] = await Promise.all([slicerS.run(), slicerMS.run()])

        const startMsIsSame = moment(resultsMillisecond.start).isSame(moment(firstDateMS));
        const endMsIsSame = moment(resultsMillisecond.end).isSame(moment(closingDateMS));

        expect(resultsSecond.start).toEqual(firstDateS.format());
        expect(resultsSecond.end).toEqual(closingDateS.format());
        expect(resultsSecond.count).toEqual(100);

        expect(startMsIsSame).toEqual(true);
        expect(endMsIsSame).toEqual(true);
        expect(resultsMillisecond.count).toEqual(100);
    });

    it('slicer can will recurse down to smallest factor and subslice by key', async () => {
        const firstDate = moment();
        const closingDate = moment(firstDate).add(1, 's');
        const endDate = moment(firstDate).add(5, 'm');
        const opConfig = {
            _op: 'elasticsearch_reader',
            date_field_name: '@timestamp',
            time_resolution: 's',
            size: 10,
            index: 'someIndex',
            interval: '5m',
            subslice_by_key: true,
            subslice_key_threshold: 50,
            key_type: 'hexadecimal',
            type: 'test'
        };
        const hexadecimal = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
        const executionConfig = { lifecycle: 'once', slicers: 1, operations: [opConfig] };
        const client = new MockClient();        
        client.deepRecursiveResponseCount = 10;
        // first two objects are consumed for determining start and end dates,
        // a middleDate is used in recursion to expand,
        client.setSequenceData([
            { '@timestamp': firstDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
            { '@timestamp': endDate, count: 100 },
        ]);

        const test = await opTest.init({ executionConfig, client });
        const results = await test.run();

        hexadecimal.forEach((char, index) => {
            const subslice = results[index];
            expect(subslice.start.format() === firstDate.format()).toEqual(true);
            expect(subslice.end.format() === closingDate.format()).toEqual(true);
            expect(subslice.key).toEqual(`test#${char}*`);
        });
    });
});
