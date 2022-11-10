import React, { useCallback, useState } from 'react';
import ImmutablePropTypes from 'react-immutable-proptypes';
import { FormattedMessage } from 'react-intl';
import Icon from 'mastodon/components/icon';
import googleLogo from 'images/google_logo.svg';
import LoadingIndicator from './loading_indicator';
import api from 'mastodon/api';
import emojify from 'mastodon/features/emoji/emoji';

/**
 * @typedef {'uninitialized'|'fetching'|'succeed'|'failed'} FetchingStatus
 */


StatusTranslation.propTypes = {
  status: ImmutablePropTypes.map.isRequired,
};

/**
 * Status Translation Component
 * @param status
 * @return {JSX.Element}
 * @constructor
 */
function StatusTranslation ({ status })  {
  /**
   * @type {string}
   * */
  const locale = document.querySelector('html').getAttribute('lang');

  const [hideTranslation, setHideTranslation] = useState(true);
  /**
   * @type {[string | undefined, React.Dispatch<React.SetStateAction<string | undefined>>]}
   */
  const [translation, setTranslation] = useState();
  /**
   * @type {[FetchingStatus, React.Dispatch<React.SetStateAction<FetchingStatus>>]}
   */
  const [translationStatus, setTranslationStatus] = useState('uninitialized');
  // to
  const [lang, setLang] = useState(locale);
  // from
  const [from, setFrom] = useState('');

  const handleTranslationClick = useCallback(async (event) => {
    event.preventDefault();
    const translationServiceEndpoint = '/translation/';

    if (hideTranslation && translation === undefined) {
      try {
        setTranslationStatus('fetching');

        const res = await api().post(translationServiceEndpoint, {
          data: {
            id: status.get('id'),
          },
        });

        // format unicode emoji in translation
        let text = emojify(res.data.text);

        setLang(res.data.to);
        setTranslation(text);
        setTranslationStatus('succeed');
        setHideTranslation(false);

        let sourceLang;

        if (res.data.from.length === 1) {
          sourceLang = res.data.from[0].displayName;
        } else {
          sourceLang = res.data.from.map(({ displayName, percentage })=>`${displayName} (${percentage})`).join(', ');
        }

        setFrom(sourceLang);
      } catch (error) {
        setTranslationStatus('failed');
        setHideTranslation(true);
      }
    } else {
      setHideTranslation(!hideTranslation);
    }
  }, [status, hideTranslation, translation]);

  return (<>
    {/* toggle button */}
    <button
      tabIndex='-1' className={'status__content__show-translation-button'}
      onClick={handleTranslationClick}
    >
      {!hideTranslation
        ? <FormattedMessage id='status.hide_translation' defaultMessage='Hide translation' />
        : <FormattedMessage id='status.show_translation' defaultMessage='Translate toot' />
      }
      &nbsp;&nbsp;
      <Icon id='language ' fixedWidth />
    </button>
    {/* !toggle button */}

    <div className='translation-content__wrapper'>
      {/* error msg */}
      <section
        className={`translation-content__failed ${translationStatus === 'failed' ? 'display' : 'hidden'}`}
      >
        <p><FormattedMessage id='status.translation_failed' defaultMessage='Fetch translation failed' /></p>
      </section>
      {/* !error msg */}

      {/* loading */}
      <section
        className={`translation-content__loading ${translationStatus === 'fetching' ? 'display' : 'hidden'}`}
      >
        <LoadingIndicator />
      </section>
      {/* !loading */}

      {/* succeed */}
      <section
        className={`translation-content__succeed ${translationStatus === 'succeed' && !hideTranslation ? 'display' : 'hidden'}`}
      >
        <div className='quote-status status-public'>
          <p className='translation-content__powered-by'>
            <FormattedMessage
              id='status.translation_by' defaultMessage='Translated from {from} by {google}'
              values={{
                google: <img alt='Google' draggable='false' src={googleLogo} />,
                from: <b>{from}</b>,
              }}
            />
          </p>
          <div
            className='translation-content status__content__text status__content__text--visible translate'
            dangerouslySetInnerHTML={{ __html: translation }}
            lang={lang}
          />
        </div>
      </section>
      {/* !succeed */}
    </div>
  </>);
}

export default StatusTranslation;
