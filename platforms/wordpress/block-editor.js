/**
 * MediaSFU Widget Block for WordPress Gutenberg
 *
 * This file registers a Gutenberg block for embedding MediaSFU widgets.
 */

(function(blocks, element, blockEditor, components, i18n) {
    const el = element.createElement;
    const { registerBlockType } = blocks;
    const { InspectorControls, useBlockProps } = blockEditor;
    const { PanelBody, TextControl, SelectControl, ToggleControl } = components;
    const { __ } = i18n;

    const WIDGET_TYPES = [
        { label: 'Call Button', value: 'call-button' },
        { label: 'Meeting Join', value: 'meeting-join' },
        { label: 'AI Agent', value: 'ai-agent' },
        { label: 'Web Agent', value: 'web-agent' },
        { label: 'Calls Dashboard', value: 'calls' },
        { label: 'Agents Dashboard', value: 'agent-dashboard' },
    ];

    const THEMES = [
        { label: 'Light', value: 'light' },
        { label: 'Dark', value: 'dark' },
        { label: 'Auto', value: 'auto' },
    ];

    const POSITIONS = [
        { label: 'Inline', value: 'inline' },
        { label: 'Bottom Right', value: 'bottom-right' },
        { label: 'Bottom Left', value: 'bottom-left' },
        { label: 'Floating', value: 'floating' },
    ];

    registerBlockType('mediasfu/widget', {
        title: __('MediaSFU Widget', 'mediasfu-widgets'),
        description: __('Embed MediaSFU widgets - video calls, AI agents, and more.', 'mediasfu-widgets'),
        icon: 'video-alt2',
        category: 'embed',
        keywords: [
            __('mediasfu', 'mediasfu-widgets'),
            __('video', 'mediasfu-widgets'),
            __('call', 'mediasfu-widgets'),
            __('meeting', 'mediasfu-widgets'),
            __('ai agent', 'mediasfu-widgets'),
        ],

        attributes: {
            widgetKey: {
                type: 'string',
                default: '',
            },
            widgetType: {
                type: 'string',
                default: 'call-button',
            },
            destination: {
                type: 'string',
                default: '',
            },
            buttonText: {
                type: 'string',
                default: 'Call Now',
            },
            theme: {
                type: 'string',
                default: 'light',
            },
            position: {
                type: 'string',
                default: 'inline',
            },
            agentId: {
                type: 'string',
                default: '',
            },
            configName: {
                type: 'string',
                default: '',
            },
            operatorName: {
                type: 'string',
                default: '',
            },
            mode: {
                type: 'string',
                default: 'voice',
            },
            roomPrefix: {
                type: 'string',
                default: '',
            },
            showPreview: {
                type: 'boolean',
                default: true,
            },
            requireName: {
                type: 'boolean',
                default: true,
            },
            allowEscalation: {
                type: 'boolean',
                default: false,
            },
            width: {
                type: 'string',
                default: '100%',
            },
            height: {
                type: 'string',
                default: '680px',
            },
        },

        edit: function(props) {
            const { attributes, setAttributes } = props;
            const blockProps = useBlockProps();

            const renderTypeSpecificControls = () => {
                switch (attributes.widgetType) {
                    case 'call-button':
                        return el(
                            element.Fragment,
                            null,
                            el(TextControl, {
                                label: __('Destination', 'mediasfu-widgets'),
                                help: __('Phone number, SIP URI, or user ID', 'mediasfu-widgets'),
                                value: attributes.destination,
                                onChange: function(value) {
                                    setAttributes({ destination: value });
                                },
                            }),
                            el(TextControl, {
                                label: __('Button Text', 'mediasfu-widgets'),
                                value: attributes.buttonText,
                                onChange: function(value) {
                                    setAttributes({ buttonText: value });
                                },
                            })
                        );

                    case 'ai-agent':
                        return el(
                            element.Fragment,
                            null,
                            el(TextControl, {
                                label: __('Agent ID', 'mediasfu-widgets'),
                                value: attributes.agentId,
                                onChange: function(value) {
                                    setAttributes({ agentId: value });
                                },
                            }),
                            el(SelectControl, {
                                label: __('Mode', 'mediasfu-widgets'),
                                value: attributes.mode,
                                options: [
                                    { label: 'Voice', value: 'voice' },
                                    { label: 'Multimodal', value: 'multimodal' },
                                ],
                                onChange: function(value) {
                                    setAttributes({ mode: value });
                                },
                            })
                        );

                    case 'web-agent':
                        return el(
                            element.Fragment,
                            null,
                            el(TextControl, {
                                label: __('Configuration name', 'mediasfu-widgets'),
                                value: attributes.configName,
                                onChange: function(value) { setAttributes({ configName: value }); },
                            }),
                            el(SelectControl, {
                                label: __('Mode', 'mediasfu-widgets'),
                                value: attributes.mode,
                                options: [
                                    { label: 'Text', value: 'text' },
                                    { label: 'Voice', value: 'voice' },
                                    { label: 'Multimodal', value: 'multimodal' },
                                ],
                                onChange: function(value) { setAttributes({ mode: value }); },
                            }),
                            el(ToggleControl, {
                                label: __('Allow human escalation', 'mediasfu-widgets'),
                                checked: attributes.allowEscalation,
                                onChange: function(value) { setAttributes({ allowEscalation: value }); },
                            })
                        );

                    case 'agent-dashboard':
                        return el(TextControl, {
                            label: __('Operator name', 'mediasfu-widgets'),
                            value: attributes.operatorName,
                            onChange: function(value) { setAttributes({ operatorName: value }); },
                        });

                    case 'meeting-join':
                        return el(
                            element.Fragment,
                            null,
                            el(TextControl, {
                                label: __('Room Prefix', 'mediasfu-widgets'),
                                value: attributes.roomPrefix,
                                onChange: function(value) {
                                    setAttributes({ roomPrefix: value });
                                },
                            }),
                            el(ToggleControl, {
                                label: __('Show Preview', 'mediasfu-widgets'),
                                checked: attributes.showPreview,
                                onChange: function(value) {
                                    setAttributes({ showPreview: value });
                                },
                            }),
                            el(ToggleControl, {
                                label: __('Require Name', 'mediasfu-widgets'),
                                checked: attributes.requireName,
                                onChange: function(value) {
                                    setAttributes({ requireName: value });
                                },
                            })
                        );

                    default:
                        return null;
                }
            };

            return el(
                element.Fragment,
                null,
                el(
                    InspectorControls,
                    null,
                    el(
                        PanelBody,
                        { title: __('Widget Settings', 'mediasfu-widgets'), initialOpen: true },
                        el(TextControl, {
                            label: __('Widget Key', 'mediasfu-widgets'),
                            help: __('Get this from your MediaSFU dashboard', 'mediasfu-widgets'),
                            value: attributes.widgetKey,
                            onChange: function(value) {
                                setAttributes({ widgetKey: value });
                            },
                        }),
                        el(SelectControl, {
                            label: __('Widget Type', 'mediasfu-widgets'),
                            value: attributes.widgetType,
                            options: WIDGET_TYPES,
                            onChange: function(value) {
                                setAttributes({ widgetType: value });
                            },
                        }),
                        el(SelectControl, {
                            label: __('Theme', 'mediasfu-widgets'),
                            value: attributes.theme,
                            options: THEMES,
                            onChange: function(value) {
                                setAttributes({ theme: value });
                            },
                        }),
                        el(SelectControl, {
                            label: __('Position', 'mediasfu-widgets'),
                            value: attributes.position,
                            options: POSITIONS,
                            onChange: function(value) {
                                setAttributes({ position: value });
                            },
                        }),
                        el(TextControl, {
                            label: __('Width', 'mediasfu-widgets'),
                            value: attributes.width,
                            onChange: function(value) {
                                setAttributes({ width: value });
                            },
                        }),
                        el(TextControl, {
                            label: __('Height', 'mediasfu-widgets'),
                            value: attributes.height,
                            onChange: function(value) {
                                setAttributes({ height: value });
                            },
                        })
                    ),
                    el(
                        PanelBody,
                        { title: __('Type Options', 'mediasfu-widgets'), initialOpen: true },
                        renderTypeSpecificControls()
                    )
                ),
                el(
                    'div',
                    blockProps,
                    el(
                        'div',
                        {
                            className: 'mediasfu-widget-preview',
                            style: {
                                padding: '20px',
                                border: '1px dashed #ccc',
                                borderRadius: '8px',
                                textAlign: 'center',
                                background: attributes.theme === 'dark' ? '#1a1a1a' : '#f8f9fa',
                                color: attributes.theme === 'dark' ? '#fff' : '#333',
                            }
                        },
                        el('span', {
                            className: 'dashicons dashicons-video-alt2',
                            style: { fontSize: '32px', width: '32px', height: '32px' }
                        }),
                        el('p', { style: { margin: '10px 0 5px' } },
                            el('strong', null, 'MediaSFU Widget')
                        ),
                        el('p', { style: { margin: 0, fontSize: '12px', opacity: 0.8 } },
                            'Type: ' + attributes.widgetType
                        ),
                        !attributes.widgetKey && el(
                            'p',
                            {
                                style: {
                                    margin: '10px 0 0',
                                    color: '#d63638',
                                    fontSize: '12px'
                                }
                            },
                            __('Please enter a widget key in the settings panel', 'mediasfu-widgets')
                        )
                    )
                )
            );
        },

        save: function() {
            // Dynamic block - rendered by PHP
            return null;
        },
    });

})(
    window.wp.blocks,
    window.wp.element,
    window.wp.blockEditor,
    window.wp.components,
    window.wp.i18n
);
