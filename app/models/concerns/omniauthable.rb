# frozen_string_literal: true

module Omniauthable
  extend ActiveSupport::Concern

  TEMP_EMAIL_PREFIX = 'change@me'
  TEMP_EMAIL_REGEX  = /\A#{TEMP_EMAIL_PREFIX}/.freeze

  included do
    devise :omniauthable

    def omniauth_providers
      Devise.omniauth_configs.keys
    end

    def email_present?
      email && email !~ TEMP_EMAIL_REGEX
    end
  end

  class_methods do
    def find_for_oauth(auth, signed_in_resource = nil)
      # EOLE-SSO Patch
      auth.uid = (auth.uid[0][:uid] || auth.uid[0][:user]) if auth.uid.is_a? Hashie::Array
      identity = Identity.find_for_oauth(auth)

      # If a signed_in_resource is provided it always overrides the existing user
      # to prevent the identity being locked with accidentally created accounts.
      # Note that this may leave zombie accounts (with no associated identity) which
      # can be cleaned up at a later date.
      user   = signed_in_resource || identity.user
      user ||= create_for_oauth(auth)

      return nil if user.nil?

      if identity.user.nil?
        identity.user = user
        identity.save!
      end

      user
    end

    def create_for_oauth(auth)
      Rails.logger.info "Creating user for #{auth.provider} identity"
      Rails.logger.info "  auth.info: #{auth.info.to_json}"
      Rails.logger.info "  auth.uid: #{auth.uid}"
      # Check if the user exists with provided email. If no email was provided,
      # we assign a temporary email and ask the user to verify it on
      # the next step via Auth::SetupController.show

      strategy          = Devise.omniauth_configs[auth.provider.to_sym].strategy
      assume_verified   = strategy&.security&.assume_email_is_verified
      email_is_verified = auth.info.verified || auth.info.verified_email || auth.info.email_verified || assume_verified
      email             = trusted_auth_provider_email(auth)
      # email             = nil unless email_is_verified or trusted_auth_provider(auth)

      user = User.find_by(email: email) if email_is_verified or trusted_auth_provider(auth)

      return user unless user.nil?

      return nil if is_registration_limited

      user = User.new(user_params_from_auth(email, auth))

      user.account.avatar_remote_url = auth.info.image if /\A#{URI::DEFAULT_PARSER.make_regexp(%w(http https))}\z/.match?(auth.info.image)
      user.skip_confirmation! if email_is_verified or trusted_auth_provider(auth)
      user.save!
      user.prepare_for_new_auth_login_user!(auth.provider)
      user
    end

    private
      # user     = User.new(email: options[:email], password: password, agreement: true, approved: true, admin: options[:role] == 'admin', moderator: options[:role] == 'moderator', confirmed_at: options[:confirmed] ? Time.now.utc : nil, bypass_invite_request_check: true)

    def user_params_from_auth(email, auth)
      username = ensure_unique_username(auth)
      password = SecureRandom.hex(10)

      Redisable.redis.del("oauth_user_random_password:#{username}")
      Redisable.redis.setex("oauth_user_random_password:#{username}", 20.minutes.seconds, password)

      {
        email: email || "#{TEMP_EMAIL_PREFIX}-#{auth.uid}-#{auth.provider}.com",
        password: password,
        agreement: true,
        approved: true,
        external: true,
        confirmed_at: Time.now.utc,
        locale: I18n.locale.to_s,
        bypass_invite_request_check: true,
        account_attributes: {
          username: username,
          display_name: trusted_auth_provider_display_name(auth) ||
                        auth.info.full_name || auth.info.name || [auth.info.first_name, auth.info.last_name].join(' '),
        },
      }
    end

    def ensure_unique_username(auth)
      username = auth.uid
      auth_provided_username = nil
      i        = 1
      force_use_number_suffix = false

      if %w(github gitee gitlab).include?(auth.provider)
        auth_provided_username = auth.info.nickname
      elsif %(azure_oauth2).include?(auth.provider)
        auth_provided_username = 'azure'
        force_use_number_suffix = true
      end

      username = auth_provided_username unless auth_provided_username.nil? || auth_provided_username.empty?

      username = ensure_valid_username(username)

      username = "#{username}_#{i}" if force_use_number_suffix
      i += 1 if force_use_number_suffix

      while Account.exists?(username: username, domain: nil)
        i       += 1
        username = "#{auth_provided_username || auth.uid}_#{i}"
      end

      username
    end

    def ensure_valid_username(starting_username)
      starting_username = starting_username.split('@')[0]
      temp_username = starting_username.gsub(/[^a-z0-9_]+/i, '')
      validated_username = temp_username.truncate(30, omission: '')
      validated_username
    end
    
    def trusted_auth_provider(auth)
      %w(github gitlab gitee azure_oauth2).include?(auth.provider)
    end

    def trusted_auth_provider_display_name(auth)
      if %w(github gitee gitlab azure_oauth2).include?(auth.provider)
        return auth.info.name
      end

      return nil
    end

    def trusted_auth_provider_email(auth)
      if %w(gitlab azure_oauth2).include?(auth.provider)
        return auth.info.email
      elsif %w(github).include?(auth.provider)
        return auth.info.email || auth.extra['all_emails'].select{ |email| email.primary? }[0]&.email
      elsif %w(gitee).include?(auth.provider)
        return auth.info.email || auth.extra['all_emails'].select{ |email| email['scope'].include? 'primary' }[0]&.email
      end

      return auth.info.verified_email || auth.info.email
    end

    def is_registration_limited()
      if ENV['AUTO_REGISTRATION_WITH_AUTH_PROVIDERS'] == 'true'
        return false
      elsif Setting.registrations_mode != 'open'
        return true
      else
        return false
      end
    end
  end
end
