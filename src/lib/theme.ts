export const palette = {
  light: {
    background: '#F7F8F4',
    surface: '#FFFFFF',
    surfaceMuted: '#EDF1ED',
    text: '#192D32',
    muted: '#5B6D72',
    primary: '#176B57',
    primarySoft: '#E5F2EB',
    onPrimary: '#FFFFFF',
    border: '#DAE2DC',
    danger: '#AE3238',
    dangerSoft: '#FCECEE',
    success: '#176B57',
    warning: '#886013',
    overlay: 'rgba(9, 24, 28, 0.42)',
  },
  dark: {
    background: '#111D21',
    surface: '#1B2A2F',
    surfaceMuted: '#23363B',
    text: '#EFF5F2',
    muted: '#B0C0C0',
    primary: '#79D9B5',
    primarySoft: '#244439',
    onPrimary: '#12362B',
    border: '#36494D',
    danger: '#FFAAA9',
    dangerSoft: '#4B2A30',
    success: '#79D9B5',
    warning: '#EDC575',
    overlay: 'rgba(0, 0, 0, 0.6)',
  },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 40 } as const;
export const radius = { sm: 10, md: 16, lg: 24, xl: 32 } as const;
