import { getStore, getDeployStore } from '@netlify/blobs';
import { createReportsHandler, storeScope } from '../../lib/handler.mjs';

export default createReportsHandler({openStore:context=>storeScope(context)==='production'
  ?getStore({name:'reports-production',consistency:'strong'})
  :getDeployStore({name:'reports-testing',consistency:'strong'})});

export const config={path:'/api/reports',method:'POST',rateLimit:{action:'rate_limit',aggregateBy:['ip'],windowSize:60,windowLimit:5}};
