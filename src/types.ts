export type AWBucket = {
  id: string;
  created: string;
  type: string;
  client: string;
  hostname: string;
  last_updated: string;
};

export type AWEvent = {
  /**
   * Date as an ISO string
   */
  timestamp: string;

  /**
   * Duration in seconds
   */
  duration: number;
  data: any;
};
