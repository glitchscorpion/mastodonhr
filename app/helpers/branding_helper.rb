# frozen_string_literal: true

module BrandingHelper
  def logo_as_symbol(version = :icon)
    case version
    when :icon
      _logo_as_symbol_icon
    when :wordmark
      _logo_as_symbol_wordmark
    when :wordmark_with_sub
      suffix != '' ? _logo_as_symbol_wordmark_with_sub : _logo_as_symbol_wordmark
    end
  end

  def _logo_as_symbol_wordmark
    content_tag(:svg, tag(:use, href: '#logo-symbol-wordmark'), viewBox: '0 0 261 66', class: 'logo logo--wordmark')
  end

  def _logo_as_symbol_wordmark_with_sub
    content_tag(:svg, tag(:use, href: '#logo-symbol-wordmark-with-sub'), viewBox: '0 0 261 66', class: 'logo logo--wordmark')
  end

  def _logo_as_symbol_icon
    content_tag(:svg, tag(:use, href: '#logo-symbol-icon'), viewBox: '0 0 79 79', class: 'logo logo--icon')
  end

  def render_logo
    image_pack_tag("logo#{suffix}.svg", alt: 'Mastodon', class: 'logo logo--icon')
  end

  def render_symbol(version = :icon)
    path = begin
      case version
      when :icon
        "logo-symbol-icon#{suffix}.svg"
      when :wordmark
        "logo-symbol-wordmark#{suffix}.svg"
      when :wordmark_with_sub
        "logo-symbol-wordmark#{suffix != '' ? '-with-sub' : ''}#{suffix}.svg"
      end
    end

    render(file: Rails.root.join('app', 'javascript', 'images', path)).html_safe # rubocop:disable Rails/OutputSafety
  end

  def suffix
    ENV['LOGO_PACK'] || ''
  end
end
