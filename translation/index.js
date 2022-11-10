const express = require('express');
const translate = require('@vitalets/google-translate-api');
const dotenv = require('dotenv');
const log = require('npmlog');
const { JSDOM } = require('jsdom');

/**
 * Stack item processing options
 * @typedef StackItemOption
 * @type {object}
 */

/**
 * Node items to be processed
 * @typedef StackItem
 * @type {object}
 * @property {ChildNode} node
 * @property {StackItemOption|undefined} options
 */


const TARGET_NODE_NAMES = ['div', 'em', 'span', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'p', 'i', 'strong', 'b', 'del', 's', 'blockquote'].map(tag => tag.toUpperCase());
const TEXT_NODE_NAME = '#text';
const BYPASS_FLAG = 'translation-bypass';
/*
 * @type {Array.<selectors>}
 */
const BYPASS_CLASS_NAME_LIST = [ // class names that should add `BYPASS_FLAG`
  'a span.invisible', 'a span.ellipsis', // mastodon's link formatter
  'a.u-url.mention.status-link', // @ tag
];

const UNKNOWN_LANGUAGE = 'unknown';

const env = process.env.NODE_ENV || 'development';

dotenv.config({
  path: env === 'production' ? '.env.production' : '.env',
});

log.level = process.env.LOG_LEVEL || 'verbose';

const port = process.env.PORT || 5000;

const languages = translate.languages;
languages['zh-cn'] = languages['zh-CN'];
languages['zh-tw'] = languages['zh-TW'];
languages['zh-hk'] = languages['zh-TW'];
languages['zh-HK'] = languages['zh-TW'];

/**
 * Get translation
 * @param {string} query
 * @param {string} to
 * @param {string} tld
 * @param {boolean} batch
 * @returns {Promise<{from: string, text}|string>}
 */
const translation = async (query, to, tld, batch = true) => {
  if (!query) return { from: '', text: '' };

  const req = translate(query, { to, tld });

  if (!batch) {
    return req.then(res => ({
      text: res.text, from: res.from.language.iso,
    })).catch(error => {
      return JSON.stringify({
        error: error.toString(), query, to, tld,
      });
    });
  } else {
    const res = await req;

    return {
      text: res.text, from: res.from.language.iso,
    };
  }
};

/**
 * `ChildNode` recursive handler
 * @param {ChildNode} node
 * @param {Array.<StackItem>} stack
 * @param {StackItemOption|undefined} outerOptions
 * @return {void}
 */
const childNodeHandler = (node, stack, outerOptions = undefined) => {
  if (node.nodeName === TEXT_NODE_NAME) {
    if (node.textContent.trim()) {
      stack.push({ node, options: outerOptions });
    }
  } else if (TARGET_NODE_NAMES.includes(node.nodeName)) {
    // filter tags that should bypass
    if (node.classList.contains(BYPASS_FLAG)) {
      return;
    }
    node.childNodes.forEach(child => {
      childNodeHandler(child, stack);
    });
  }
};

/**
 * Display language name
 * @param {string} code
 * @param {string} locale
 * @return {string}
 */
const getLanguageDisplayName = (code, locale) => {
  if (['zh-cn', 'zh-sg'].includes(code.toLowerCase())) {
    code = 'zh-hans';
  }
  if (['zh-hk', 'zh-tw'].includes(code.toLowerCase())) {
    code = 'zh-hant';
  }
  return new Intl.DisplayNames([locale], { type: 'language' }).of(code);
};

/**
 * Guess language percentages
 * @param {Array.<string>} languages
 * @param {string} locale to display language name in locale
 * @return {{percentage: string, language}[]}
 */
const guessLanguage = (languages, locale) => {
  const counts = {};

  for (const num of languages) {
    counts[num] = counts[num] ? counts[num] + 1 : 1;
  }

  return Object.entries(counts)
    // eslint-disable-next-line no-unused-vars
    .sort(([_a, a], [_b, b]) => Number(b) - Number(a))
    .map(([key, count]) => {
      let percentage = count / languages.length * 1000;
      percentage = Math.round(percentage);
      percentage = Math.max(percentage, 1);
      percentage /= 10;
      return {
        language: key || UNKNOWN_LANGUAGE,
        percentage: `${percentage}%`,
        displayName: getLanguageDisplayName(key, locale),
      };
    });
};

/**
 * Handle query string trilling and beginning spaces
 * @param {string} query
 * @return {{beginningSpace: boolean, trillingSpace: boolean, query: string}}
 */
const querySpaceHandler = query => {
  let beginningSpace = false;
  let trillingSpace = false;
  if (query.startsWith(' ')) {
    beginningSpace = true;
    query = query.slice(1);
  }
  if (query.endsWith(' ')) {
    trillingSpace = true;
    query = query.slice(0, -1);
  }
  return { query, beginningSpace, trillingSpace };
};

/**
 * Handle query string trilling and beginning spaces
 * @param {string} result
 * @param {boolean} beginningSpace
 * @param {boolean} trillingSpace
 * @return {string}
 */
const resultHandler = (result, beginningSpace, trillingSpace) => {
  result = result.replace(/\s+$/, '');
  result = result.replace(/^\s+/, '');
  result = `${beginningSpace ? ' ' : ''}${result}${trillingSpace ? ' ' : ''}`;
  result = result.replace(/：\s$/, '：');
  return result;
};

/**
 * Health check endpoint callback
 * @param {express['request']} _request
 * @param {express['response']} response
 */
const healthEndpointCallback = (_request, response) => {
  // log.verbose('[success]', 'health check');

  response.json({
    status: 'OK',
  });
};

/**
 * Translation endpoint callback
 * @param {express['request']} request
 * @param {express['response']} response
 */
const translationEndpointCallback = async (request, response) => {
  const body = request.body;

  const { content, to, status, edit } = body;

  if (!content) {
    response.status(400).send({
      message: 'Empty Content', emptyContent: true,
    });
    return;
  }

  if (!to) {
    response.status(400).send({
      message: 'Empty To', emptyTo: true,
    });
    return;
  }

  const tld = body.tld || 'com';

  const batch = body.batch ?? true;

  const logger = { to, status, edit, batch, tld };

  logger.errors = [];

  try {
    const languages = [];

    /**
     * Processing stack
     * @type {Array.<StackItem>}
     */
    const stack = [];

    const fragment = JSDOM.fragment(`<div>${content}</div>`);

    // add bypass flag for nodes
    fragment.querySelectorAll(`${BYPASS_CLASS_NAME_LIST.join(',')}`).forEach(node => {
      node.classList.add(BYPASS_FLAG);
    });

    // add wrapper and bypass `#` in hash tags
    fragment.querySelectorAll('a.mention.hashtag.status-link').forEach(node => {
      node.innerHTML = node.innerHTML.replace('#', `<span class="hash_char ${BYPASS_FLAG}">#</span>`);
    });

    fragment.childNodes.forEach(node => {
      childNodeHandler(node, stack);
    });


    if (stack.length === 0) {
      logger.errors.push('No thing to translate');
    } else if (batch) {
      const batchStack = [];

      stack.forEach((stackItem, nodeIndex) => {
        const { node } = stackItem;
        const lines = node.textContent.split('\n');

        lines.forEach(line => {
          const { query, beginningSpace, trillingSpace } = querySpaceHandler(line);
          batchStack.push({ node, query, beginningSpace, trillingSpace, nodeIndex });
        });
      });

      const batchQuery = batchStack.map(item => item.query).join('\n');

      const { from, text } = await translation(batchQuery, to, tld);

      const batchResults = text.split('\n');

      const resultStack = [];

      batchResults.forEach((result, index) => {
        const { node, nodeIndex, beginningSpace, trillingSpace } = batchStack[index];

        result = resultHandler(result, beginningSpace, trillingSpace);

        if (!resultStack[nodeIndex]) {
          resultStack[nodeIndex] = { result, node };
        } else {
          resultStack[nodeIndex].result += `/n${result}`;
        }
      });

      resultStack.forEach(process => {
        process.node.textContent = process.result;
      });

      languages.push(from);
    } else {
      const jobRes = await Promise.all(stack.map(async stackItem => {
        const { node } = stackItem;
        const { query, beginningSpace, trillingSpace } = querySpaceHandler(node.textContent);

        const res = await translation(query, to, tld, false);

        if (typeof res === 'string') {
          logger.errors.push(res);
          return false;
        } else {
          const { text, from } = res;

          node.textContent = resultHandler(text, beginningSpace, trillingSpace);

          languages.push(from);
          return true;
        }
      }));

      if (jobRes.every(res => !res)) {
        throw new Error('All translation failed');
      }
    }

    fragment.querySelectorAll(`.${BYPASS_FLAG}`).forEach(node => {
      node.classList.remove(BYPASS_FLAG);
    });

    const from = guessLanguage(languages, to);

    if (from.length === 0) {
      from.push({
        language: UNKNOWN_LANGUAGE, percentage: '100%', displayName: getLanguageDisplayName(UNKNOWN_LANGUAGE, to),
      });
    }

    const unknownLanguage = from.find(item => item.language === UNKNOWN_LANGUAGE);

    if (unknownLanguage) {
      const req = await translation('Unknown language', to, tld);
      unknownLanguage.displayName = req.text;
    }

    if (env === 'development') {
      logger.content = content;
    }

    if (logger.errors.length === 0) {
      delete logger.errors;
    }

    log.verbose('[success]', JSON.stringify(logger));

    response.json({
      text: fragment.firstChild.innerHTML, from, to,
    });
  } catch (err) {
    logger.error = err.toString();
    logger.content = content;

    if (logger.errors.length === 0) {
      delete logger.errors;
    }

    log.error('[error]', JSON.stringify(logger));

    response.status(400).send({
      message: err.toString(),
    });
  }
};


const app = express();
app.use(express.json());

app.get('/health', healthEndpointCallback);
app.post('*', translationEndpointCallback);

app.listen(port, () => log.warn(`Translation API server is now listening on port ${port}`));
