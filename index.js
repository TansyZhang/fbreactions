require('dotenv').config();
var rp = require('request-promise');
var _ = require('lodash');
var appId = process.env.FB_APP_ID;
var secret =  process.env.FB_APP_SECRET;
var access_token = appId + '|' + secret;;

var redis = require("redis");
client = redis.createClient({host:process.env.REDIS_HOST});


var endpointConfig ={
  'reactions':{
    endpoint:'<%= postId %>/reactions',
    defaultParams:{
      'limit':1000,
      'summary':true
    }
  },
  'page': {
    endpoint:'<%= pageId %>',
    defaultParams:{
      'fields':'posts.limit(100)'
    }
  }
}

var pages ={
  'tw':{
    'appledaily.tw':'232633627068'
  }
}

function getUrlByEndpoint(endpoint,endpointParams){
  var template = 'https://graph.facebook.com/v2.6/';
  return _.template(template+endpointConfig[endpoint]['endpoint'])(endpointParams);
}


var apiFactory = function(endpoint){
  return function(defaultParams, params){
    var endpointUrl = getUrlByEndpoint(endpoint,params);
    params= _.assign(defaultParams,params)
    params['access_token']=access_token;
    return rp.get({
      uri:endpointUrl,
      qs:params,
      json:true
    });
  }
}
var FbAPI = {};
Object.keys(endpointConfig).forEach(function(key){
  var config = endpointConfig[key];
  FbAPI[key]=apiFactory(key).bind(this, config['defaultParams']);
});

//Same as fb
function generatePostKey(pageId, postId){
  return [pageId,postId].join('_');
}

function getId(resId){
  return resId.split('_')[1];
}

function fetchAndStorePosts(pageId){
  return FbAPI['page']({'pageId':pageId})
  .then(function(data){
    Promise.all(_.map(data.posts.data, function(post){
      var created_time = Date.parse(post.created_time);
      return client.zaddAsync('tw', -created_time, post.id);
    }));
  });
}

function fetchLatestPostIds(){
  return client.zrangeAsync('tw',1,100);
}

var initCount = {};
// 'NONE',
var reactionTypes=['LIKE','LOVE','WOW','HAHA','SAD','ANGRY'];
_.forEach(reactionTypes,function (reaction) {
  initCount[reaction]=0;
});

function countReactions(postId){

  function countAndFollow(counts, data){
    _.forEach(data.data,function (reaction) {
      counts[reaction.type]++;
    });
    if(data.summary){
      counts['total']=data.summary.total_count;
    }
    if(data.paging && data.paging.next){
      return rp.get({
        uri:data.paging.next,
        json:true
      })
      .then(countAndFollow.bind(undefined,counts));
    }else{
      return counts;
    }
  }

  return FbAPI['reactions']({postId:postId}).then(function (data) {
    return countAndFollow(_.clone(initCount),data);
  });
}

function countAndStoreReactions(postId){
  return countReactions(postId).then(function (counts) {
    var keyValues = _.flatten(_.zip(_.keys(counts),_.values(counts)));
  // expensive crawl so persist indivudally
    return client.hmsetAsync(postId,keyValues);
  })

}

//TODO
// fetchLatestPostIds.then(function (ids) {
// countAndStoreReactions
// })
// pages['tw']['appledaily.tw']



module.exports = {
  pages:pages,
  getUrlByEndpoint:getUrlByEndpoint,
  FbAPI:FbAPI,
  fetchAndStorePosts:fetchAndStorePosts,
  fetchLatestPostIds:fetchLatestPostIds,
  countReactions:countReactions,
  countAndStoreReactions:countAndStoreReactions
}
