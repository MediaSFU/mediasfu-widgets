<?php
/**
 * Plugin Name: MediaSFU Widgets
 * Plugin URI: https://mediasfu.com/plugins/wordpress
 * Description: Embed MediaSFU widgets on your WordPress site - video calls, AI agents, click-to-call buttons, and more.
 * Version: 1.0.0
 * Author: MediaSFU
 * Author URI: https://mediasfu.com
 * License: MIT
 * Text Domain: mediasfu-widgets
 */

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

define('MEDIASFU_WIDGETS_VERSION', '1.0.0');
define('MEDIASFU_WIDGETS_URL', plugin_dir_url(__FILE__));
define('MEDIASFU_CDN_URL', 'https://cdn.mediasfu.com/v1/widget.js');

/**
 * Enqueue the MediaSFU widget script
 */
function mediasfu_enqueue_widget_script() {
    wp_enqueue_script(
        'mediasfu-widgets',
        MEDIASFU_CDN_URL,
        array(),
        MEDIASFU_WIDGETS_VERSION,
        true
    );
}
add_action('wp_enqueue_scripts', 'mediasfu_enqueue_widget_script');

/**
 * Register the MediaSFU Widget shortcode
 *
 * Usage: [mediasfu_widget key="wk_xxx" type="call-button" destination="+1234567890"]
 */
function mediasfu_widget_shortcode($atts) {
    $atts = shortcode_atts(array(
        'key' => '',
        'type' => 'call-button',
        'destination' => '',
        'button_text' => '',
        'button_icon' => '',
        'theme' => 'light',
        'position' => 'inline',
        'agent_id' => '',
        'config_name' => '',
        'operator_name' => '',
        'allow_escalation' => 'false',
        'mode' => 'voice',
        'room_prefix' => '',
        'show_preview' => 'true',
        'require_name' => 'true',
        'require_email' => 'false',
        'width' => '100%',
        'height' => '600px',
    ), $atts, 'mediasfu_widget');

    if (empty($atts['key'])) {
        return '<!-- MediaSFU Widget: Missing widget key -->';
    }

    $widget_tags = array(
        'call-button' => 'mediasfu-call-button',
        'meeting-join' => 'mediasfu-meeting-join',
        'ai-agent' => 'mediasfu-ai-agent',
        'web-agent' => 'mediasfu-web-agent',
        'calls' => 'mediasfu-calls',
        'agent-dashboard' => 'mediasfu-agent-dashboard',
    );
    $widget_type = isset($widget_tags[$atts['type']]) ? $atts['type'] : 'call-button';
    $tag_name = $widget_tags[$widget_type];

    // Build attributes
    $html_atts = array(
        'widget-key' => $atts['key'],
        'theme' => $atts['theme'],
        'position' => $atts['position'],
    );

    // Add type-specific attributes
    switch ($widget_type) {
        case 'call-button':
            if (!empty($atts['destination'])) $html_atts['destination'] = $atts['destination'];
            if (!empty($atts['button_text'])) $html_atts['button-text'] = $atts['button_text'];
            if (!empty($atts['button_icon'])) $html_atts['button-icon'] = $atts['button_icon'];
            break;

        case 'ai-agent':
            if (!empty($atts['agent_id'])) $html_atts['agent-id'] = $atts['agent_id'];
            if (!empty($atts['mode'])) $html_atts['mode'] = $atts['mode'];
            $html_atts['width'] = $atts['width'];
            $html_atts['height'] = $atts['height'];
            break;

        case 'meeting-join':
            if (!empty($atts['room_prefix'])) $html_atts['room-prefix'] = $atts['room_prefix'];
            $html_atts['show-preview'] = $atts['show_preview'];
            $html_atts['require-name'] = $atts['require_name'];
            $html_atts['require-email'] = $atts['require_email'];
            break;

        case 'web-agent':
            if (!empty($atts['config_name'])) $html_atts['config-name'] = $atts['config_name'];
            if (!empty($atts['mode'])) $html_atts['mode'] = $atts['mode'];
            $html_atts['allow-escalation'] = $atts['allow_escalation'];
            $html_atts['width'] = $atts['width'];
            $html_atts['height'] = $atts['height'];
            break;

        case 'calls':
            $html_atts['width'] = $atts['width'];
            $html_atts['height'] = $atts['height'];
            break;

        case 'agent-dashboard':
            if (!empty($atts['operator_name'])) $html_atts['operator-name'] = $atts['operator_name'];
            $html_atts['width'] = $atts['width'];
            $html_atts['height'] = $atts['height'];
            break;
    }

    // Build HTML
    $attr_string = '';
    foreach ($html_atts as $key => $value) {
        $attr_string .= sprintf(' %s="%s"', esc_attr($key), esc_attr($value));
    }

    return sprintf('<%s%s></%s>', $tag_name, $attr_string, $tag_name);
}
add_shortcode('mediasfu_widget', 'mediasfu_widget_shortcode');

/**
 * Register Gutenberg Block
 */
function mediasfu_register_block() {
    if (!function_exists('register_block_type')) {
        return;
    }

    // Register block script
    wp_register_script(
        'mediasfu-block-editor',
        MEDIASFU_WIDGETS_URL . 'block-editor.js',
        array('wp-blocks', 'wp-element', 'wp-editor', 'wp-components', 'wp-i18n'),
        MEDIASFU_WIDGETS_VERSION,
        true
    );

    register_block_type('mediasfu/widget', array(
        'editor_script' => 'mediasfu-block-editor',
        'render_callback' => 'mediasfu_block_render',
        'attributes' => array(
            'widgetKey' => array(
                'type' => 'string',
                'default' => '',
            ),
            'widgetType' => array(
                'type' => 'string',
                'default' => 'call-button',
            ),
            'destination' => array(
                'type' => 'string',
                'default' => '',
            ),
            'buttonText' => array(
                'type' => 'string',
                'default' => 'Call Now',
            ),
            'theme' => array(
                'type' => 'string',
                'default' => 'light',
            ),
            'position' => array(
                'type' => 'string',
                'default' => 'inline',
            ),
            'agentId' => array('type' => 'string', 'default' => ''),
            'configName' => array('type' => 'string', 'default' => ''),
            'operatorName' => array('type' => 'string', 'default' => ''),
            'mode' => array('type' => 'string', 'default' => 'voice'),
            'roomPrefix' => array('type' => 'string', 'default' => ''),
            'showPreview' => array('type' => 'boolean', 'default' => true),
            'requireName' => array('type' => 'boolean', 'default' => true),
            'allowEscalation' => array('type' => 'boolean', 'default' => false),
            'width' => array('type' => 'string', 'default' => '100%'),
            'height' => array('type' => 'string', 'default' => '680px'),
        ),
    ));
}
add_action('init', 'mediasfu_register_block');

/**
 * Block render callback
 */
function mediasfu_block_render($attributes) {
    return mediasfu_widget_shortcode(array(
        'key' => $attributes['widgetKey'],
        'type' => $attributes['widgetType'],
        'destination' => $attributes['destination'],
        'button_text' => $attributes['buttonText'],
        'theme' => $attributes['theme'],
        'position' => $attributes['position'],
        'agent_id' => $attributes['agentId'],
        'config_name' => $attributes['configName'],
        'operator_name' => $attributes['operatorName'],
        'mode' => $attributes['mode'],
        'room_prefix' => $attributes['roomPrefix'],
        'show_preview' => $attributes['showPreview'] ? 'true' : 'false',
        'require_name' => $attributes['requireName'] ? 'true' : 'false',
        'allow_escalation' => $attributes['allowEscalation'] ? 'true' : 'false',
        'width' => $attributes['width'],
        'height' => $attributes['height'],
    ));
}

/**
 * Add settings page
 */
function mediasfu_add_settings_page() {
    add_options_page(
        'MediaSFU Widgets',
        'MediaSFU Widgets',
        'manage_options',
        'mediasfu-widgets',
        'mediasfu_settings_page'
    );
}
add_action('admin_menu', 'mediasfu_add_settings_page');

/**
 * Settings page content
 */
function mediasfu_settings_page() {
    ?>
    <div class="wrap">
        <h1>MediaSFU Widgets Settings</h1>

        <div class="card">
            <h2>Quick Start</h2>
            <p>Add MediaSFU widgets to your site using shortcodes or Gutenberg blocks.</p>

            <h3>Shortcode Examples</h3>
            <p><code>[mediasfu_widget key="YOUR_WIDGET_KEY" type="call-button" destination="+1234567890"]</code></p>
            <p><code>[mediasfu_widget key="YOUR_WIDGET_KEY" type="ai-agent" agent_id="YOUR_AGENT_ID"]</code></p>
            <p><code>[mediasfu_widget key="YOUR_WIDGET_KEY" type="meeting-join"]</code></p>

            <h3>Get Your Widget Key</h3>
            <p>Create domain-scoped public keys in <a href="https://mediasfu.com/dashboard?mode=regular#widget-builder" target="_blank" rel="noopener noreferrer">MediaSFU Widget Builder</a>.</p>
        </div>

        <div class="card">
            <h2>Widget Types</h2>
            <table class="widefat">
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Key Attributes</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>call-button</strong></td>
                        <td>Click-to-call button</td>
                        <td>destination, button_text, button_icon, position</td>
                    </tr>
                    <tr>
                        <td><strong>ai-agent</strong></td>
                        <td>AI voice or multimodal agent</td>
                        <td>agent_id, mode, width, height</td>
                    </tr>
                    <tr>
                        <td><strong>meeting-join</strong></td>
                        <td>Meeting join form</td>
                        <td>room_prefix, show_preview, require_name</td>
                    </tr>
                    <tr><td><strong>web-agent</strong></td><td>Text, voice, multimodal, and escalation flows</td><td>config_name, mode, allow_escalation</td></tr>
                    <tr><td><strong>calls</strong></td><td>Calls and telephony dashboard</td><td>width, height</td></tr>
                    <tr><td><strong>agent-dashboard</strong></td><td>Agent monitoring and operator takeover</td><td>operator_name, width, height</td></tr>
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2>Documentation</h2>
            <p><a href="https://mediasfu.com/widget-studio-guide" target="_blank" rel="noopener noreferrer" class="button">View Widget Studio Guide</a></p>
        </div>
    </div>
    <?php
}
