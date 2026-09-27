use std::ops::Range;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Cursor {
    selected: usize,
    offset: usize,
}

impl Cursor {
    pub fn selected(self) -> usize {
        self.selected
    }

    pub fn step(&mut self, delta: isize, len: usize) {
        self.selected = self
            .selected
            .saturating_add_signed(delta)
            .min(len.saturating_sub(1));
    }

    pub fn visible(&mut self, len: usize, height: usize) -> Range<usize> {
        if len == 0 || height == 0 {
            return 0..0;
        }
        self.selected = self.selected.min(len - 1);
        if self.selected < self.offset {
            self.offset = self.selected;
        }
        if self.selected >= self.offset + height {
            self.offset = self.selected + 1 - height;
        }
        self.offset = self.offset.min(len.saturating_sub(height));
        self.offset..(self.offset + height).min(len)
    }
}
