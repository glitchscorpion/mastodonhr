RuCaptcha.configure do
  # Color style, default: :colorful, allows: [:colorful, :black_white]
  # self.style = :colorful
  # Custom captcha code expire time if you need, default: 2 minutes
  # self.expires_in = 120
  # self.cache_store = :redis_cache_store, REDIS_CACHE_PARAMS
  self.cache_store = :redis_cache_store #Rails.application.config.cache_store
  # self.skip_cache_store_check = true
  # Chars length, default: 5, allows: [3 - 7]
  # self.length = 5
  # enable/disable Strikethrough.
  # self.strikethrough = true
  # enable/disable Outline style
  # self.outline = false
end
