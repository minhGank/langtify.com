import { fireEvent, render, screen } from '@testing-library/react-native';
import { Avatar } from '@/components/ui/avatar';

it.each([32, 48, 64, 88])(
  'keeps a %s-point fallback initial inside a centered line box',
  (size) => {
    render(<Avatar username="learner" size={size} />);
    const initial = screen.getByLabelText("learner's profile photo");
    const fontSize = Math.round(size * 0.38);
    expect(initial).toHaveTextContent('L');
    expect(initial).toHaveStyle({
      fontSize,
      lineHeight: Math.ceil(fontSize * 1.25),
      includeFontPadding: false,
      textAlign: 'center',
    });
    expect(initial).toHaveProp('allowFontScaling', false);
  },
);

it('centers a real image with cover mode and falls back safely on image failure', () => {
  const view = render(<Avatar username="learner" uri="file:///avatar.jpg" size={88} />);
  const image = screen.getByLabelText("learner's profile photo");
  expect(image).toHaveProp('resizeMode', 'cover');
  fireEvent(image, 'error');
  expect(screen.getByLabelText("learner's profile photo")).toHaveTextContent('L');
  view.rerender(<Avatar username="learner" uri="file:///replacement.jpg" size={88} />);
  expect(screen.getByLabelText("learner's profile photo")).toHaveProp('source', {
    uri: 'file:///replacement.jpg',
    cache: 'reload',
  });
});

it('renders the empty-username fallback without depending on a bundled image baseline', () => {
  render(<Avatar username="" />);
  expect(screen.getByLabelText("Langtify's profile photo")).toHaveTextContent('L');
});
