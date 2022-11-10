# frozen_string_literal: true

class TranslationController < ApplicationController
  include Authorization
  include FormattingHelper
  include StatusesHelper
  include Redisable

  before_action :authenticate_user!

  def show
    unless ENV['TRANSLATION_SERVER_HOST']
      render json: { 'message' => 'TRANSLATION_SERVER_HOST not found in ENV'}, status:400
      return
    end

    endpoint = ENV['TRANSLATION_SERVER_HOST']
    tld = ENV['TRANSLATION_GOOGLE_TLD'] || 'cn'
    batch = (ENV['TRANSLATION_BATCH'] || 'true') == 'true'

    status_id = params[:data][:id]

    status = Status.find(status_id)

    status_edited_at = status.edited_at.to_i

    status_content = prerender_custom_emojis(status_content_format(status), status.emojis)

    to = I18n.locale.to_s

    cache_key = "translation:#{status_id}:#{status_edited_at}:#{to}:#{tld}:#{batch}"

    cached = redis.get(cache_key)

    if cached
      render json: ActiveSupport::JSON.decode(cached)
    else
      request_body = { content: status_content, to: to, tld: tld, batch: batch, status: status_id, edit: status_edited_at }
      request_header = { 'Content-Type' => 'application/json' }
      resp = Faraday.post(endpoint, request_body.to_json, request_header)

      if resp.status == 200
        redis.setex(cache_key, 24.hours.minutes.seconds, resp.body)
        render json: ActiveSupport::JSON.decode(resp.body)
      else
        render json: ActiveSupport::JSON.decode(resp.body), status: resp.status
      end
    end
  end

  private

  def prerender_custom_emojis(html, custom_emojis, other_options = {})
    EmojiFormatter.new(html, custom_emojis, other_options.merge(animate: prefers_autoplay?)).to_s
  end
end
