import { theme as antdTheme, type ThemeConfig } from 'antd';

/** AntD 深色主题：与 docs/prototype/index.html 的配色保持一致 */
export const theme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#3B82F6',
    colorInfo: '#3B82F6',
    colorSuccess: '#22C55E',
    colorWarning: '#F59E0B',
    colorError: '#EF4444',
    colorLink: '#3B82F6',
    colorBgBase: '#0F172A',
    colorBgContainer: '#1B2336',
    colorBgElevated: '#222D44',
    colorBgLayout: '#0F172A',
    colorBorder: '#334155',
    colorBorderSecondary: '#273248',
    colorText: '#F8FAFC',
    colorTextSecondary: '#CBD5E1',
    colorTextTertiary: '#94A3B8',
    colorTextQuaternary: '#64748B',
    borderRadius: 8,
    fontFamily:
      "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, -apple-system, sans-serif",
  },
  components: {
    Layout: {
      headerBg: '#131B2E',
      siderBg: '#131B2E',
      bodyBg: '#0F172A',
      triggerBg: '#1B2336',
      triggerColor: '#94A3B8',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(59,130,246,0.15)',
      itemSelectedColor: '#3B82F6',
      itemHoverBg: 'rgba(59,130,246,0.08)',
      itemColor: '#CBD5E1',
    },
    Card: {
      colorBgContainer: '#1B2336',
      colorBorderSecondary: '#334155',
    },
    Table: {
      headerBg: '#1B2336',
      headerColor: '#94A3B8',
      rowHoverBg: '#273248',
      borderColor: '#334155',
      headerSplitColor: 'transparent',
    },
    Modal: {
      contentBg: '#1B2336',
      headerBg: '#1B2336',
    },
    Select: {
      optionSelectedBg: 'rgba(59,130,246,0.15)',
    },
    Input: {
      activeBorderColor: '#3B82F6',
      hoverBorderColor: '#475569',
    },
    Tabs: {
      itemSelectedColor: '#3B82F6',
      inkBarColor: '#3B82F6',
    },
    Dropdown: {
      colorBgElevated: '#222D44',
    },
  },
};
