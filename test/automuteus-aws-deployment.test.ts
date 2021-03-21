import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as AutomuteusAwsDeployment from '../lib/automuteus-aws-deployment-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new AutomuteusAwsDeployment.AutomuteusAwsDeploymentStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
