import { useFlyerStore } from './flyerStore';

describe('flyerStore', () => {
  beforeEach(() => {
    useFlyerStore.getState().clear();
  });

  it('adds an analyzed flyer to the front of the list', async () => {
    await useFlyerStore.getState().analyzeFlyer({ imageUrl: 'https://example.com/a.jpg' });

    const { flyers, isAnalyzing, error } = useFlyerStore.getState();
    expect(isAnalyzing).toBe(false);
    expect(error).toBeNull();
    expect(flyers).toHaveLength(1);
    expect(flyers[0]).toMatchObject({ title: expect.any(String), tags: expect.any(Array) });
  });

  it('removes a flyer by id', async () => {
    await useFlyerStore.getState().analyzeFlyer({ imageUrl: 'https://example.com/a.jpg' });
    const id = useFlyerStore.getState().flyers[0].id;

    useFlyerStore.getState().removeFlyer(id);
    expect(useFlyerStore.getState().flyers).toHaveLength(0);
  });
});
