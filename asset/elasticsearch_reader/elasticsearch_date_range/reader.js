'use strict';

const elasticApi = require('@terascope/elasticsearch-api');

function newReader(context, opConfig, executionConfig, client) {
    let formatData = false;
    if (opConfig.preserve_id) {
        formatData = true;
        opConfig.full_response = true;
    }
    return (msg, logger) => {
        const elasticsearch = elasticApi(client, logger, opConfig);
        const query = elasticsearch.buildQuery(opConfig, msg);
        if (formatData) {
            return elasticsearch.search(query)
                .then(fullResponseObj => fullResponseObj.hits.hits.map((doc) => {
                    const record = doc._source;
                    record._key = doc._id;
                    return record;
                }));
        }
        return elasticsearch.search(query);
    };
}

module.exports = newReader;
