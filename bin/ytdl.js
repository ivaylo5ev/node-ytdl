#!/usr/bin/env node


var info = require('../package');

var opts = require('nomnom')
  .option('version', {
    abbr: 'v',
    flag: true,
    callback: function() {
      console.log(info.version);
      process.exit();
    },
    help: 'Print program version.'
  })
  .option('url', {
    position: 0,
    required: true,
    help: 'URL to the video.'
  })
  .option('quality', {
    abbr: 'q',
    metavar: 'ITAG',
    help: 'Video quality to download, default: highest'
  })
  .option('range', {
    abbr: 'r',
    metavar: 'INT-INT',
    help: 'Byte range to download, ie 10355705-12452856'
  })
  .option('output', {
    abbr: 'o',
    metavar: 'FILE',
    help: 'Save to file, template by {prop}, default: stdout'
  })
  .option('filterContainer', {
    full: 'filter-container',
    metavar: 'REGEXP',
    help: 'Filter in format container'
  })
  .option('unfilterContainer', {
    full: 'unfilter-container',
    metavar: 'REGEXP',
    help: 'Filter out format container'
  })
  .option('filterResolution', {
    full: 'filter-resolution',
    metavar: 'REGEXP',
    help: 'Filter in format resolution'
  })
  .option('unfilterResolution', {
    full: 'unfilter-resolution',
    metavar: 'REGEXP',
    help: 'Filter out format resolution'
  })
  .option('filterEncoding', {
    full: 'filter-encoding',
    metavar: 'REGEXP',
    help: 'Filter in format encoding'
  })
  .option('unfilterEncoding', {
    full: 'unfilter-encoding',
    metavar: 'REGEXP',
    help: 'Filter out format encoding'
  })
  .option('info', {
    abbr: 'i',
    flag: true,
    help: 'Print video info without downloading'
  })
  .option('printUrl', {
    full: 'print-url',
    flag: true,
    help: 'Print direct download URL'
  })
  .option('noCache', {
    full: 'no-cache',
    flat: true,
    help: 'Skip file cache for html5player'
  })
  .option('debug', {
    flag: true,
    help: 'Print debug information'
  })
  .script('ytdl')
  .colors()
  .parse()
  ;


var path    = require('path');
var fs      = require('fs');
var ytdl    = require('ytdl-core');
var homedir = require('homedir');
var util    = require('../lib/util');
require('colors');


if (opts.cache !== false) {
  // Keep cache in file.
  var cachefile = path.resolve(homedir(), '.ytdl-cache.json');
  fs.readFile(cachefile, function(err, contents) {
    if (err) return;
    try {
      ytdl.cache.store = JSON.parse(contents);
    } catch (err) {}
  });

  ytdl.cache.set = function(key, value) {
    ytdl.cache.store[key] = value;
    fs.writeFile(cachefile, JSON.stringify(ytdl.cache.store, null, 2), function() {});
  };
}


/**
 * Prints basic video information.
 *
 * @param {Object} info
 */
function printVideoInfo(info) {
  console.log();
  console.log('title: '.grey.bold + info.title);
  console.log('author: '.grey.bold + info.author.name);
  console.log('average rating: '.grey.bold + info.avg_rating);
  console.log('view count: '.grey.bold + info.view_count);
  console.log('length: '.grey.bold + util.toHumanTime(info.length_seconds));
}


if (opts.info) {
  var cliff = require('cliff');
  ytdl.getInfo(opts.url, { debug: opts.debug }, function(err, info) {
    if (err) {
      console.error(err.message);
      process.exit(1);
      return;
    }

    printVideoInfo(info);

    var cols = [
      'itag',
      'container',
      'resolution',
      'video enc',
      'audio bitrate',
      'audio enc'
    ];
    info.formats.forEach(function(format) {
      format['video enc']     = format.encoding;
      format['audio bitrate'] = format.audioBitrate;
      format['audio enc']     = format.audioEncoding;
      cols.forEach(function(col) {
        format[col] = format[col] || '';
      });
    });
    console.log('formats:'.grey.bold);
    var colors = ['green', 'blue', 'green', 'blue', 'green', 'blue'];
    console.log(cliff.stringifyObjectRows(info.formats, cols, colors));
  });
  return;
}

var output = opts.output;
var ext = (output || '').match(/(\.\w+)?$/)[1];

if (output) {
  if (ext && !opts.quality && !opts.filterContainer) {
    opts.filterContainer = '^' + ext.slice(1) + '$';
  }
}

var ytdlOptions = {};
ytdlOptions.quality = /,/.test(opts.quality) ?
  opts.quality.split(',') : opts.quality;
ytdlOptions.range = opts.range;

// Create filters.
var filters = [];

/**
 * @param {String} field
 * @param {String} regexpStr
 * @param {Boolean|null} negated
 */
function createFilter(field, regexpStr, negated) {
  try {
    var regexp = new RegExp(regexpStr, 'i');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  filters.push(function(format) {
    return negated !== regexp.test(format[field]);
  });
}

['container', 'resolution', 'encoding'].forEach(function(field) {
  var key = 'filter' + field[0].toUpperCase() + field.slice(1);
  if (opts[key]) {
    createFilter(field, opts[key], false);
  }

  key = 'un' + key;
  if (opts[key]) {
    createFilter(field, opts[key], true);
  }
});

ytdlOptions.filter = function(format) {
  return filters.every(function(filter) {
    return filter(format);
  });
};

if (opts.printUrl) {
  ytdl.getInfo(opts.url, { debug: opts.debug }, function(err, info) {
    if (err) {
      console.error(err.message);
      process.exit(1);
      return;
    }
    var format = ytdl.chooseFormat(info.formats, ytdlOptions);
    if (format instanceof Error) {
      console.error(format.message);
      process.exit(1);
      return;
    }
    console.log(format.url);
  });
  return;
}

var readStream = ytdl(opts.url, ytdlOptions);
var myinfo, myformat;

readStream.on('info', function(info, format) {
  myinfo = info;
  myformat = format;
});

readStream.on('response', function(res) {
  if (!output) {
    readStream.pipe(process.stdout);
    return;
  }

  output = util.tmpl(output, [myinfo, myformat]);
  if (!ext && myformat.container) {
    output += '.' + myformat.container;
  }
  readStream.pipe(fs.createWriteStream(output));

  // Print information about the video if not streaming to stdout.
  printVideoInfo(myinfo);

  // Print information about the format we're downloading.
  var size = parseInt(res.headers['content-length'], 10);
  console.log('container: '.grey.bold + myformat.container);
  console.log('resolution: '.grey.bold + myformat.resolution);
  console.log('encoding: '.grey.bold + myformat.encoding);
  console.log('size: '.grey.bold + util.toHumanSize(size) +
             ' (' + size +' bytes)');
  console.log('output: '.grey.bold + output);
  console.log();

  // Create progress bar.
  var bar = require('progress-bar').create(process.stdout, 50);
  var throttle = require('lodash.throttle');
  bar.format = '$bar; $percentage;%';

  var lastPercent = null;
  var updateBar = function() {
    var percent = dataRead / size;
    newPercent = Math.floor(percent * 100);
    if (newPercent != lastPercent) {
      lastPercent = newPercent;
      bar.update(percent);
    }
  };
  var updateBarThrottled = throttle(updateBar, 100, { trailing: false });

  // Keep track of progress.
  var dataRead = 0;
  readStream.on('data', function(data) {
    dataRead += data.length;
    if (dataRead === size) {
      updateBar();
    } else {
      updateBarThrottled();
    }
  });
});

readStream.on('error', function(err) {
  console.error(err.message);
  process.exit(1);
});

readStream.on('end', function onend() {
  console.log();
});

process.on('SIGINT', function onsigint() {
  console.log();
  process.exit();
});
